/** Body of POST /posts/:id/publish — the platform keys the user selected to
 * publish this post to. Validated non-empty; ownership + connected checks happen
 * in the service. */
export interface IStartPublishPayload {
	platforms: string[];
}

/** Parsed, normalized query for GET /executions (owner-scoped history list,
 * #7). All optional; the service applies sensible defaults + owner scoping. */
export interface IListExecutionsQuery {
	page?: string;
	limit?: string;
	sort?: string;
	status?: string;
	dateFrom?: string;
	dateTo?: string;
}
