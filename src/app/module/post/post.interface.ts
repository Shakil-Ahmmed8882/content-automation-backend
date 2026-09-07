export interface ICreatePostPayload {
	title?: string;
	content: string;
}

/** Parsed, normalized list query (owner-scoped list — design D4). */
export interface IListPostsQuery {
	page?: string;
	limit?: string;
	sort?: string;
	search?: string;
}
