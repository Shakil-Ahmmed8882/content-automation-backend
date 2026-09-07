import crypto from "node:crypto";
import httpStatus from "http-status";
import type { Payment } from "../../../generated/prisma/client";
import type { Prisma } from "../../../generated/prisma/client";
import { PaymentStatus } from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/appError";
import { writeAuditLog } from "../../utils/audit";
import { BKASH_SUCCESS_CODE, getPaymentGateway } from "./payment.gateway";
import type { IListPaymentsQuery } from "./payment.interface";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/** Client-facing view of a payment — never the raw `gatewayResponse` (audit
 * only) or gateway session id. */
const toPublicPayment = (payment: Payment) => ({
	id: payment.id,
	provider: payment.provider,
	purpose: payment.purpose,
	amount: payment.amount,
	currency: payment.currency,
	status: payment.status,
	merchantInvoiceNumber: payment.merchantInvoiceNumber,
	providerTransactionId: payment.providerTransactionId,
	paidAt: payment.paidAt,
	createdAt: payment.createdAt,
});

/** POST /payments/create — start a bKash payment for the premium upgrade. Reads
 * the amount/currency from config, records a PENDING payment with a unique
 * merchant reference, asks the gateway for a session, stores the gateway payment
 * id, and returns the redirect URL (design D4). */
const create = async (userId: string) => {
	const amount = config.premium_price;
	const currency = config.premium_currency;
	const merchantInvoiceNumber = `INV-${crypto.randomUUID()}`;

	const payment = await prisma.payment.create({
		data: { userId, amount, currency, merchantInvoiceNumber, payerReference: userId },
	});

	const callbackURL = `${config.backend_url}/api/v1/payments/callback`;
	const result = await getPaymentGateway().create({
		amount,
		currency,
		merchantInvoiceNumber,
		payerReference: userId,
		callbackURL,
	});

	await prisma.payment.update({
		where: { id: payment.id },
		data: {
			providerPaymentId: result.providerPaymentId,
			gatewayResponse: result.raw as Prisma.InputJsonValue,
		},
	});

	return { paymentId: payment.id, redirectUrl: result.redirectUrl };
};

/** Confirm a payment with the gateway (never trust a client/callback status) and,
 * on confirmed success, settle the payment + activate premium atomically and
 * exactly once (design D2/D3). Idempotent: an already-SUCCESS payment no-ops, and
 * the PENDING→SUCCESS flip is the single atomic gate that grants premium, so a
 * replay can never double-grant. */
const executeAndVerify = async (payment: Payment): Promise<Payment> => {
	if (payment.status === PaymentStatus.SUCCESS) {
		return payment; // already settled — replay no-op
	}
	if (!payment.providerPaymentId) {
		throw new AppError(httpStatus.BAD_REQUEST, "This payment has no gateway session to verify");
	}

	const result = await getPaymentGateway().execute(payment.providerPaymentId);

	if (result.statusCode !== BKASH_SUCCESS_CODE) {
		// Only downgrade a still-pending payment — never overwrite a SUCCESS.
		await prisma.payment.updateMany({
			where: { id: payment.id, status: PaymentStatus.PENDING },
			data: {
				status: PaymentStatus.FAILED,
				gatewayResponse: result.raw as Prisma.InputJsonValue,
			},
		});
		return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
	}

	return prisma.$transaction(async (tx) => {
		// The PENDING→SUCCESS flip is the atomic gate: exactly one caller wins it.
		const flipped = await tx.payment.updateMany({
			where: { id: payment.id, status: PaymentStatus.PENDING },
			data: {
				status: PaymentStatus.SUCCESS,
				providerTransactionId: result.transactionId ?? null,
				gatewayResponse: result.raw as Prisma.InputJsonValue,
				paidAt: new Date(),
			},
		});
		if (flipped.count === 1) {
			const user = await tx.user.findUniqueOrThrow({ where: { id: payment.userId } });
			await tx.user.update({
				where: { id: payment.userId },
				data: { isPremium: true, premiumSince: user.premiumSince ?? new Date() },
			});

			// Best-effort, additive audit entry — never gatewayResponse/secrets.
			await writeAuditLog({
				actorId: payment.userId,
				action: "PAYMENT_VERIFIED",
				entityType: "Payment",
				entityId: payment.id,
				metadata: { amount: payment.amount.toString(), currency: payment.currency },
			});
		}
		return tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
	});
};

/** GET /payments/callback — bKash redirects the browser here with its paymentID
 * + status. Unauthenticated (the gateway calls it), identified by the gateway
 * payment id. On a "success" status we still call execute to CONFIRM; a
 * non-success status settles the payment without granting anything. */
const handleCallback = async (
	providerPaymentId: string | undefined,
	status: string | undefined,
) => {
	if (!providerPaymentId) {
		return { success: false };
	}
	const payment = await prisma.payment.findUnique({ where: { providerPaymentId } });
	if (!payment) {
		return { success: false };
	}

	if (status && status.toLowerCase() !== "success") {
		const nextStatus =
			status.toLowerCase() === "cancel" ? PaymentStatus.CANCELLED : PaymentStatus.FAILED;
		await prisma.payment.updateMany({
			where: { id: payment.id, status: PaymentStatus.PENDING },
			data: { status: nextStatus },
		});
		return { success: false };
	}

	const settled = await executeAndVerify(payment);
	return { success: settled.status === PaymentStatus.SUCCESS };
};

/** POST /payments/verify — owner-scoped safety-net re-verify (idempotent). */
const verify = async (userId: string, paymentId: string) => {
	const payment = await prisma.payment.findFirst({ where: { id: paymentId, userId } });
	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
	}
	const settled = await executeAndVerify(payment);
	return toPublicPayment(settled);
};

/** GET /payments/:id — owner-scoped status read. */
const getStatus = async (userId: string, paymentId: string) => {
	const payment = await prisma.payment.findFirst({ where: { id: paymentId, userId } });
	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
	}
	return toPublicPayment(payment);
};

const isPaymentStatus = (value: string): value is PaymentStatus =>
	Object.values(PaymentStatus).includes(value as PaymentStatus);

/** GET /payments — owner-scoped, paginated payment history, newest first.
 * Every row (including FAILED/CANCELLED) is included unless filtered by
 * `status`; only the public projection is returned — never `gatewayResponse`. */
const listMine = async (userId: string, query: IListPaymentsQuery) => {
	const page = Math.max(1, Number.parseInt(query.page ?? "", 10) || 1);
	const requestedLimit = Number.parseInt(query.limit ?? "", 10) || DEFAULT_LIMIT;
	const limit = Math.min(Math.max(1, requestedLimit), MAX_LIMIT);
	const skip = (page - 1) * limit;

	const where: Prisma.PaymentWhereInput = {
		userId,
		...(query.status && isPaymentStatus(query.status) ? { status: query.status } : {}),
	};

	const [rows, total] = await Promise.all([
		prisma.payment.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
		prisma.payment.count({ where }),
	]);

	return {
		data: rows.map(toPublicPayment),
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

export const PaymentService = {
	create,
	executeAndVerify,
	handleCallback,
	verify,
	getStatus,
	listMine,
};
