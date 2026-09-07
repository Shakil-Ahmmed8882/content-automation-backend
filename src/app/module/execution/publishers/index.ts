import { facebookPublisher } from "./facebook.publisher";
import { linkedinPublisher } from "./linkedin.publisher";
import type { SocialPublisher } from "./publisher.interface";

// Registry keyed on platform.key (design D3). Adding a provider = register its
// publisher here; the worker and service are untouched. `registerPublisher` is
// also the seam a test uses to plug a deterministic publisher onto a throwaway
// platform (there is no way to hit real LinkedIn/Facebook in an automated run).
const registry = new Map<string, SocialPublisher>();

export const registerPublisher = (publisher: SocialPublisher): void => {
	registry.set(publisher.key, publisher);
};

/** The publisher for a platform key, or null if none is registered (an unknown
 * or not-yet-wired platform). The worker fails that publication cleanly. */
export const getPublisher = (platformKey: string): SocialPublisher | null =>
	registry.get(platformKey) ?? null;

registerPublisher(linkedinPublisher);
registerPublisher(facebookPublisher);
