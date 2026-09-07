import crypto from "node:crypto";
import config from "../config";

// AES-256-GCM encryption for secrets at rest (social-connections OAuth tokens,
// design D3). The ciphertext is authenticated (GCM tag), so tampering is
// detected on decrypt. This module is the single boundary around encryption —
// swapping to a KMS later is a one-file change (design D3 alternative).

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the standard for GCM
const KEY_BYTES = 32; // AES-256

// Derive a fixed 32-byte key from whatever TOKEN_ENCRYPTION_KEY holds via
// SHA-256, so any non-empty secret string is usable (a raw 32-byte hex key, a
// passphrase, etc.) without forcing a specific length/encoding on the operator.
const getKey = (): Buffer => {
	const secret = config.token_encryption_key;
	if (!secret) {
		throw new Error("TOKEN_ENCRYPTION_KEY is not set — cannot encrypt/decrypt tokens.");
	}
	return crypto.createHash("sha256").update(secret).digest().subarray(0, KEY_BYTES);
};

/**
 * Encrypts a plaintext string. Output is `iv:authTag:ciphertext`, each part
 * base64. A fresh random IV per call means the same plaintext encrypts to
 * different ciphertext every time (semantic security).
 */
export const encrypt = (plaintext: string): string => {
	const iv = crypto.randomBytes(IV_BYTES);
	const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(
		":",
	);
};

/**
 * Reverses `encrypt`. Throws if the payload is malformed or the auth tag fails
 * (tampered ciphertext / wrong key) — callers treat a throw as "unusable
 * credential" rather than silently returning garbage.
 */
export const decrypt = (payload: string): string => {
	const parts = payload.split(":");
	if (parts.length !== 3) {
		throw new Error("Malformed ciphertext payload");
	}
	const [ivB64, authTagB64, dataB64] = parts as [string, string, string];
	const iv = Buffer.from(ivB64, "base64");
	const authTag = Buffer.from(authTagB64, "base64");
	const data = Buffer.from(dataB64, "base64");

	const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
};
