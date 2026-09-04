import nodemailer from "nodemailer";
import config from "../config";

export const transporter = nodemailer.createTransport({
	service: "gmail",
	auth: {
		user: config.smtp_user,
		pass: config.smtp_password,
	},
});

/**
 * Fire-and-forget mail send. A failed email must never break the request that
 * triggered it (e.g. registration still succeeds if the OTP email fails), so
 * errors are logged, not thrown.
 */
export const nodemailerSend = async ({
	to,
	subject,
	html,
}: {
	to: string;
	subject: string;
	html: string;
}) => {
	try {
		await transporter.sendMail({ from: config.email_sender, to, subject, html });
	} catch (error) {
		console.log(`Failed to send "${subject}" email to ${to}:`, error);
	}
};
