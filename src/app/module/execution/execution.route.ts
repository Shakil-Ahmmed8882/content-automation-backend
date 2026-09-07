import { Router } from "express";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ExecutionController } from "./execution.controller";
import { ExecutionValidation } from "./execution.validation";

// Mounted at /api/v1/posts (alongside PostRoutes) so the full path is
// POST /api/v1/posts/:id/publish (proposal). Reads/history live in #7.
const router = Router();

router.post(
	"/:id/publish",
	auth(),
	validateRequest(ExecutionValidation.startPublish),
	ExecutionController.publish,
);

export const ExecutionRoutes = router;

// Retry endpoints (#6). No body — the id in the path is the whole request.
// Mounted at /api/v1/publications and /api/v1/executions respectively.
const publicationRouter = Router();
publicationRouter.post("/:id/retry", auth(), ExecutionController.retryPublication);
export const PublicationRoutes = publicationRouter;

// Executions router (#6 retry + #7 history reads), mounted at /api/v1/executions.
const executionRouter = Router();
executionRouter.get("/", auth(), ExecutionController.list);
executionRouter.get("/:id", auth(), ExecutionController.getDetail);
executionRouter.post("/:id/retry", auth(), ExecutionController.retryExecution);
export const ExecutionRetryRoutes = executionRouter;
