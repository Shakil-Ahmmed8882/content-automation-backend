import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export default {
	node_env: process.env.NODE_ENV,
	port: process.env.PORT,
	database_url: process.env.DATABASE_URL,
	backend_url: process.env.BACKEND_URL,
	frontend_url: process.env.FRONTEND_URL,
	frontend_base_url: process.env.FRONTEND_BASE_URL,
	bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS,

	// Dev/test only: include one-time OTPs in auth responses so E2E tests (and
	// local testing without SMTP access) can read them without an inbox. Gated
	// a second time at the call site by node_env !== "production" (defense in
	// depth) — this must never be true in production regardless of the flag.
	expose_otp_in_response: process.env.EXPOSE_OTP_IN_RESPONSE === "true",

	// JWT
	jwt_access_secret: process.env.JWT_ACCESS_SECRET!,
	jwt_refresh_secret: process.env.JWT_REFRESH_SECRET!,
	jwt_access_expires_in: process.env.JWT_ACCESS_EXPIRES_IN!,
	jwt_refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN!,

	// Google OAuth (login)
	google_client_id: process.env.GOOGLE_CLIENT_ID!,

	// Seed users
	super_admin_name: process.env.SUPER_ADMIN_NAME,
	super_admin_email: process.env.SUPER_ADMIN_EMAIL,
	super_admin_password: process.env.SUPER_ADMIN_PASSWORD,
	admin_name: process.env.ADMIN_NAME,
	admin_email: process.env.ADMIN_EMAIL,
	admin_password: process.env.ADMIN_PASSWORD,

	// Redis
	redis_user: process.env.REDIS_USER,
	redis_password: process.env.REDIS_PASSWORD,
	redis_host: process.env.REDIS_HOST,
	redis_port: process.env.REDIS_PORT,

	// SMTP
	smtp_host: process.env.SMTP_HOST,
	smtp_user: process.env.SMTP_USER,
	smtp_password: process.env.SMTP_PASSWORD, // gmail app password
	email_sender: process.env.EMAIL_SENDER,

	// Cloudinary
	cloudinary_cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
	cloudinary_api_key: process.env.CLOUDINARY_API_KEY,
	cloudinary_api_secret: process.env.CLOUDINARY_API_SECRET,

	// LinkedIn OAuth + publishing
	linkedin_client_id: process.env.LINKEDIN_CLIENT_ID,
	linkedin_client_secret: process.env.LINKEDIN_CLIENT_SECRET,
	linkedin_redirect_uri: process.env.LINKEDIN_REDIRECT_URI,

	// Facebook Page OAuth + publishing
	facebook_app_id: process.env.FACEBOOK_APP_ID,
	facebook_app_secret: process.env.FACEBOOK_APP_SECRET,
	facebook_redirect_uri: process.env.FACEBOOK_REDIRECT_URI,
	facebook_api_version: process.env.FACEBOOK_API_VERSION ?? "v21.0",

	// bKash payment
	bkash_base_url: process.env.BKASH_BASE_URL!,
	bkash_username: process.env.BKASH_USERNAME!,
	bkash_password: process.env.BKASH_PASSWORD!,
	bkash_app_key: process.env.BKASH_APP_KEY!,
	bkash_app_secret: process.env.BKASH_APP_SECRET!,
	bkash_callback_url: process.env.BKASH_CALLBACK_URL!,

	// Premium pricing
	premium_price: process.env.PREMIUM_PRICE ?? "500",
	premium_currency: process.env.PREMIUM_CURRENCY ?? "BDT",
};
