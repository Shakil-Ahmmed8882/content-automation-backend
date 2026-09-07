import { z } from "zod";

// The selected platform keys. Non-empty is enforced here (spec: an empty
// selection is rejected); ownership + "each platform is connected" are checked
// in the service since they need the DB.
const startPublish = z.object({
	platforms: z.array(z.string().trim().min(1)).min(1, "Select at least one platform to publish to"),
});

export const ExecutionValidation = {
	startPublish,
};
