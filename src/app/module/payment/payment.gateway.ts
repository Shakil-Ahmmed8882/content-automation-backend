import httpStatus from "http-status";
import config from "../../config";
import { getBkashGrantIdToken } from "../../lib/bkash";
import { AppError } from "../../utils/appError";

// A provider-agnostic payment gateway (design D1). The bKash tokenized-checkout
// implementation lives here behind `create`/`execute`; the service talks only to
// this interface, so adding Stripe/SSLCommerz later is a new implementation, not
// a service rewrite. `setPaymentGateway` is also the seam the E2E suite uses to
// inject a deterministic gateway (real bKash sandbox can't be driven headlessly).

export interface IGatewayCreateInput {
	amount: string;
	currency: string;
	merchantInvoiceNumber: string;
	payerReference: string;
	callbackURL: string;
}

export interface IGatewayCreateResult {
	providerPaymentId: string;
	redirectUrl: string;
	raw: unknown;
}

export interface IGatewayExecuteResult {
	/** bKash success is statusCode "0000"; anything else is a non-success. */
	statusCode: string;
	transactionId?: string;
	transactionStatus?: string;
	raw: unknown;
}

export interface IPaymentGateway {
	create(input: IGatewayCreateInput): Promise<IGatewayCreateResult>;
	execute(providerPaymentId: string): Promise<IGatewayExecuteResult>;
}

const bkashHeaders = (idToken: string) => ({
	"Content-Type": "application/json",
	Accept: "application/json",
	Authorization: idToken,
	"X-APP-Key": config.bkash_app_key,
});

const bkashGateway: IPaymentGateway = {
	create: async (input) => {
		const idToken = await getBkashGrantIdToken();
		if (!idToken) {
			throw new AppError(httpStatus.BAD_GATEWAY, "Could not authenticate with bKash");
		}
		const res = await fetch(`${config.bkash_base_url}/tokenized/checkout/create`, {
			method: "POST",
			headers: bkashHeaders(idToken),
			body: JSON.stringify({
				mode: "0011",
				payerReference: input.payerReference,
				callbackURL: input.callbackURL,
				amount: input.amount,
				currency: input.currency,
				intent: "sale",
				merchantInvoiceNumber: input.merchantInvoiceNumber,
			}),
		});
		if (!res.ok) {
			throw new AppError(httpStatus.BAD_GATEWAY, "Could not start the bKash payment");
		}
		const body = (await res.json()) as { paymentID?: string; bkashURL?: string };
		if (!body.paymentID || !body.bkashURL) {
			throw new AppError(httpStatus.BAD_GATEWAY, "bKash did not return a payment session");
		}
		return { providerPaymentId: body.paymentID, redirectUrl: body.bkashURL, raw: body };
	},

	execute: async (providerPaymentId) => {
		const idToken = await getBkashGrantIdToken();
		if (!idToken) {
			throw new AppError(httpStatus.BAD_GATEWAY, "Could not authenticate with bKash");
		}
		const res = await fetch(`${config.bkash_base_url}/tokenized/checkout/execute`, {
			method: "POST",
			headers: bkashHeaders(idToken),
			body: JSON.stringify({ paymentID: providerPaymentId }),
		});
		if (!res.ok) {
			throw new AppError(httpStatus.BAD_GATEWAY, "Could not verify the bKash payment");
		}
		const body = (await res.json()) as {
			statusCode?: string;
			trxID?: string;
			transactionStatus?: string;
		};
		return {
			statusCode: body.statusCode ?? "",
			transactionId: body.trxID,
			transactionStatus: body.transactionStatus,
			raw: body,
		};
	},
};

let activeGateway: IPaymentGateway = bkashGateway;

/** The currently active payment gateway (bKash by default). */
export const getPaymentGateway = (): IPaymentGateway => activeGateway;

/** Swap the gateway — used by the E2E suite to inject a deterministic gateway
 * (real bKash sandbox needs live credentials + a human paying). */
export const setPaymentGateway = (gateway: IPaymentGateway): void => {
	activeGateway = gateway;
};

/** Restore the real bKash gateway (test teardown). */
export const resetPaymentGateway = (): void => {
	activeGateway = bkashGateway;
};

/** bKash's success status code. */
export const BKASH_SUCCESS_CODE = "0000";
