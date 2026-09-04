## Purpose

Payment-history lets a user review their own payments — including successful, failed, and cancelled
ones — with provider, amount, and status, scoped to the owner and read-only.

## ADDED Requirements

### Requirement: A user can list their own payment history

The system SHALL return the authenticated user's payments ordered newest first, each showing the
provider, purpose, amount, currency, status, and date. It SHALL include non-successful payments
(failed and cancelled), support pagination, and support filtering by status. It SHALL NOT return
another user's payments.

#### Scenario: Payments are listed newest first with status
- **WHEN** a user lists their payment history
- **THEN** the system SHALL return their payments (including failures/cancellations) with provider,
  amount, and status, ordered newest first, paginated

#### Scenario: Filtering by status
- **WHEN** a user filters the history by a status (e.g., SUCCESS)
- **THEN** the system SHALL return only payments with that status

### Requirement: Payment history is owner-scoped and leaks no secrets

The system SHALL scope the history to the requesting user and SHALL NOT include any gateway secrets.

#### Scenario: A user sees only their own payments
- **WHEN** a user lists payment history
- **THEN** the system SHALL return only payments belonging to that user
