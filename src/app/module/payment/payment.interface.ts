/** Body of POST /payments/verify — the internal payment id to (re)verify.
 * Owner-scoped in the service; a safety net if the bKash callback was missed. */
export interface IVerifyPaymentPayload {
	paymentId: string;
}

/** Parsed, normalized query for GET /payments (owner-scoped payment history
 * list). All optional; the service applies sensible defaults + owner scoping. */
export interface IListPaymentsQuery {
	page?: string;
	limit?: string;
	status?: string;
}
