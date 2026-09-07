import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PaymentController } from "./payment.controller";
import { PaymentValidation } from "./payment.validation";

// Mounted at /api/v1/payments. Literal paths (create/callback/verify/"/") are
// declared before the dynamic /:id so none of them are captured by it. The
// callback is intentionally NOT auth()-guarded — bKash's server calls it.
const router = Router();

router.post("/create", auth(), PaymentController.create);
router.get("/callback", PaymentController.callback);
router.post(
	"/verify",
	auth(),
	validateRequest(PaymentValidation.verifyPayment),
	PaymentController.verify,
);
router.get("/", auth(), PaymentController.list);
router.get("/:id", auth(), PaymentController.getStatus);

export const PaymentRoutes = router;
