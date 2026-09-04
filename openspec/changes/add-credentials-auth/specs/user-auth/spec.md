## Purpose

User-auth provides credential-based authentication and the session lifecycle for the platform —
registration with email verification, login, logout, current-user, token refresh, and password
recovery/reset — on a provider-extensible identity model that future OAuth providers extend
without redesign.

## ADDED Requirements

### Requirement: Registration requires email verification before an account exists

The system SHALL accept a registration request containing name, email, and password. It SHALL
NOT create a persistent user account until the email address is verified with a one-time code.
Passwords MUST meet a minimum length and MUST be persisted only as a secure one-way hash — never
in plaintext. A one-time code MUST expire within a bounded time.

#### Scenario: New email starts a pending registration
- **WHEN** a registration is submitted for an email that has no account
- **THEN** the system SHALL send a one-time verification code to that email
- **AND** SHALL NOT yet create a user record

#### Scenario: Weak password is rejected
- **WHEN** a registration is submitted with a password shorter than the minimum length
- **THEN** the system SHALL reject the request with a validation error and send no code

#### Scenario: Already-registered email is refused
- **WHEN** a registration is submitted for an email that already has a verified account
- **THEN** the system SHALL reject the request and SHALL NOT send a code

#### Scenario: Abandoned registration persists nothing
- **WHEN** a pending registration is never verified within the code's lifetime
- **THEN** the system SHALL retain no user record for that email

### Requirement: Email verification completes registration and starts a session

The system SHALL complete registration only when a valid, unexpired code is presented for the
pending email. On success it SHALL create the user, create a credentials identity for that user,
mark the email verified, and issue an authenticated session.

#### Scenario: Correct code creates the account and logs the user in
- **WHEN** a valid, unexpired code is submitted for a pending registration
- **THEN** the system SHALL create the user and credentials identity, mark the email verified,
  and return an authenticated session

#### Scenario: Wrong or expired code does not create an account
- **WHEN** an incorrect or expired code is submitted
- **THEN** the system SHALL reject the request and create no user record

### Requirement: Users can log in with email and password

The system SHALL authenticate a user by email and password and issue an authenticated session on
success. Invalid credentials SHALL be rejected with a generic error that does not reveal whether
the email exists. Blocked or deleted accounts SHALL be refused.

#### Scenario: Valid credentials succeed
- **WHEN** a user submits the correct email and password for an active account
- **THEN** the system SHALL issue an authenticated session

#### Scenario: Invalid credentials fail generically
- **WHEN** a user submits an unknown email or a wrong password
- **THEN** the system SHALL reject with a generic "invalid credentials" error that does not
  disclose which field was wrong

#### Scenario: Blocked account cannot log in
- **WHEN** a user with a blocked or deleted account submits correct credentials
- **THEN** the system SHALL refuse the login

### Requirement: Sessions use a short-lived access credential with refresh rotation

The system SHALL issue a short-lived access credential and a longer-lived refresh credential,
delivered so they are not readable by client-side scripts. Protected endpoints SHALL require a
valid access credential and SHALL respond with 401 when it is missing, invalid, or expired. A
valid refresh credential SHALL be exchangeable for a new credential pair.

#### Scenario: Valid access credential reaches a protected endpoint
- **WHEN** a request to a protected endpoint carries a valid access credential
- **THEN** the system SHALL authorize it and attach the caller's identity

#### Scenario: Missing or invalid access credential is rejected
- **WHEN** a request to a protected endpoint has no valid access credential
- **THEN** the system SHALL respond with 401 Unauthorized

#### Scenario: Refresh credential rotates into a new pair
- **WHEN** a valid refresh credential is presented to the refresh endpoint
- **THEN** the system SHALL issue a new access + refresh pair

### Requirement: Users can log out

The system SHALL provide a logout action that clears the caller's session credentials so
subsequent requests are unauthenticated.

#### Scenario: Logout clears the session
- **WHEN** an authenticated user logs out
- **THEN** the system SHALL clear their session credentials

### Requirement: Authenticated users can retrieve their own profile

The system SHALL return the current authenticated user's profile (identity, name, email, role,
premium status). It SHALL NEVER include password hashes, tokens, or other secrets.

#### Scenario: Current user is returned without secrets
- **WHEN** an authenticated user requests their own profile
- **THEN** the system SHALL return their profile fields
- **AND** SHALL omit password hashes and any tokens

### Requirement: Password reset requests avoid user enumeration

The system SHALL allow a user to request a password reset by email and SHALL email a one-time
code when a credentials account exists for that email. It SHALL return the same response whether
or not the email exists, so callers cannot enumerate accounts. Accounts that have no credentials
login (e.g., OAuth-only) SHALL NOT receive a reset code.

#### Scenario: Existing credentials account receives a code
- **WHEN** a reset is requested for an email with a credentials account
- **THEN** the system SHALL email a one-time reset code

#### Scenario: Unknown email yields the same response
- **WHEN** a reset is requested for an email with no account
- **THEN** the system SHALL return the same success-style response and send no code

### Requirement: Users can reset their password with a valid code

The system SHALL let a user set a new password by presenting a valid, unexpired reset code. On
success it SHALL store the new password as a secure hash, invalidate the used code, and confirm
the change to the user by email. Invalid or expired codes SHALL be rejected.

#### Scenario: Valid code sets a new password
- **WHEN** a valid, unexpired reset code and a conforming new password are submitted
- **THEN** the system SHALL update the password hash, invalidate the code, and send a
  confirmation email

#### Scenario: Invalid or expired code is rejected
- **WHEN** an incorrect or expired reset code is submitted
- **THEN** the system SHALL reject the request and leave the password unchanged

### Requirement: Identity model is provider-extensible and links by verified email

The system SHALL represent each login method as a distinct identity keyed by provider and
provider-account-id, so additional authentication providers can be added without changing
existing behavior or the identity data shape. WHEN a new provider presents a verified email that
already belongs to a user, the system SHALL link the new identity to that existing user rather
than creating a duplicate account.

#### Scenario: A person keeps one account across login methods
- **WHEN** a verified email already owned by a user is later presented by a different provider
- **THEN** the system SHALL attach the new login identity to that same user
- **AND** SHALL NOT create a second user for the same person

### Requirement: Authentication endpoints resist abuse and never leak secrets

Registration, login, and code-sending endpoints SHALL be rate-limited. One-time codes SHALL
expire within a bounded time and be single-use. The system SHALL NEVER expose password hashes,
tokens, or internal stack traces to clients.

#### Scenario: Rapid repeated requests are throttled
- **WHEN** an endpoint that sends codes or checks credentials is called repeatedly beyond the
  allowed rate
- **THEN** the system SHALL throttle further requests

#### Scenario: Errors never reveal secrets
- **WHEN** any authentication request fails
- **THEN** the error response SHALL NOT contain password hashes, tokens, or stack traces
