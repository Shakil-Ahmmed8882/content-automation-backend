import { z } from "zod";

const verifyPayment = z.object({
	paymentId: z.string().trim().min(1, "paymentId is required"),
});

export const PaymentValidation = {
	verifyPayment,
};
