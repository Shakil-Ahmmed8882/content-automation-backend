// Short-lived OTP window shared by registration + password reset.
export const OTP_TTL_SECONDS = 5 * 60; // 5 minutes
export const OTP_TTL_MINUTES = OTP_TTL_SECONDS / 60;

// Redis key builders — one namespace per flow so keys never collide.
export const pendingRegistrationKey = (email: string) => `pending-registration:${email}`;
export const pendingRegistrationOtpKey = (email: string) => `pending-registration-otp:${email}`;
export const passwordResetOtpKey = (email: string) => `password-reset-otp:${email}`;

// Auth session cookies.
export const ACCESS_TOKEN_COOKIE = "accessToken";
export const REFRESH_TOKEN_COOKIE = "refreshToken";
export const ACCESS_COOKIE_MAX_AGE = 1000 * 60 * 60 * 24; // 1 day
export const REFRESH_COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 7; // 7 days
