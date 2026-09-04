import path from "node:path";
import ejs from "ejs";

const templatesDir = path.join(process.cwd(), "src", "app", "templates", "emails");

export type EmailTemplateName =
	| "verify-email"
	| "forgot-password"
	| "password-changed"
	| "publish-result";

/**
 * Renders one of the `src/app/templates/emails/*.ejs` templates to an HTML string.
 * Thin wrapper so callers never touch `ejs`/file paths directly.
 *
 * NOTE: templates are read from `src/` at runtime (works in dev via tsx and in
 * prod as long as `src/app/templates` ships alongside the build).
 */
export const renderEmailTemplate = (
	templateName: EmailTemplateName,
	// biome-ignore lint/suspicious/noExplicitAny: template data shape differs per template
	data: Record<string, any>,
): Promise<string> => {
	const templatePath = path.join(templatesDir, `${templateName}.ejs`);
	return ejs.renderFile(templatePath, data) as Promise<string>;
};
