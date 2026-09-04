## Purpose

Premium-payment lets a user pay (via bKash sandbox) to upgrade to Premium, recording the payment in
a ledger and activating premium only after the backend verifies success with the gateway — never on
a client-supplied signal.

## ADDED Requirements

### Requirement: A user can start a premium payment

The system SHALL let an authenticated user start a payment for the premium upgrade, recording a
pending payment with the configured amount and currency and a unique merchant reference, and
returning the gateway payment URL to continue.

#### Scenario: Payment is initiated
- **WHEN** a user starts a premium payment
- **THEN** the system SHALL create a pending payment and return the gateway URL

### Requirement: Payment success is verified server-side before granting premium

The system SHALL confirm payment success by verifying it directly with the gateway on the callback
(or via an explicit verify), and SHALL activate premium only on confirmed success. It SHALL NEVER
grant premium based on a client-supplied status.

#### Scenario: Verified success activates premium
- **WHEN** the gateway confirms a payment succeeded
- **THEN** the system SHALL mark the payment SUCCESS and set the user's premium status with the
  activation time

#### Scenario: Unverified or failed payment does not grant premium
- **WHEN** a payment is not confirmed by the gateway (failed/cancelled/unverifiable)
- **THEN** the system SHALL NOT activate premium and SHALL record the payment's non-success status

#### Scenario: Client cannot self-report success
- **WHEN** a client submits a "payment successful" claim without gateway confirmation
- **THEN** the system SHALL ignore it and not grant premium

### Requirement: Payment activation is idempotent

The system SHALL ensure a payment can be confirmed only once — a replayed or duplicate callback/
verify SHALL NOT create a second payment or grant premium twice.

#### Scenario: Replayed callback does not double-grant
- **WHEN** the gateway callback for a already-confirmed payment arrives again
- **THEN** the system SHALL treat it as already processed and change nothing further

### Requirement: A user can check a payment's status

The system SHALL let the owner retrieve the status of one of their payments.

#### Scenario: Owner reads their payment status
- **WHEN** a user requests the status of their payment
- **THEN** the system SHALL return that payment's current status

### Requirement: Payment operations are owner-scoped and leak no secrets

The system SHALL scope payment reads/verification to the owning user and SHALL NOT expose gateway
secrets or internal errors to the client.

#### Scenario: A user cannot act on another user's payment
- **WHEN** a user requests or verifies a payment they do not own
- **THEN** the system SHALL refuse and reveal nothing
