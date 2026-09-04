## Purpose

Publication-retry lets a user manually re-run a failed platform publish — rebinding to their
current connection and appending a new attempt — without touching the platforms that already
succeeded, and without any automatic retrying.

## ADDED Requirements

### Requirement: A user can retry a failed publication

The system SHALL let a user retry a failed publication, appending a new attempt (the next attempt
number) under it and re-running the publish in the background. On success it SHALL mark the
publication successful with the external post reference; on failure it SHALL record the new reason.

#### Scenario: Retry of a failed publication succeeds
- **WHEN** a user retries a publication that previously failed and the cause is resolved
- **THEN** the system SHALL append a new successful attempt and mark the publication SUCCESS

#### Scenario: Retry that still fails records the new reason
- **WHEN** a retry is attempted but the platform rejects it again
- **THEN** the system SHALL append a new failed attempt with the new reason

### Requirement: Only failed publications can be retried

The system SHALL allow retry only for publications in a failed state; retrying a successful or
in-progress publication SHALL be refused.

#### Scenario: Retrying a successful publication is refused
- **WHEN** a user retries a publication that already succeeded
- **THEN** the system SHALL refuse the request

### Requirement: Retry rebinds to the user's current connection

The system SHALL, on retry, resolve the user's current connection for the publication's platform
and use it for the attempt. If the user has no current connection for that platform, retry SHALL be
refused with guidance to reconnect first.

#### Scenario: Retry after reconnecting uses the new connection
- **WHEN** a user reconnects a platform and retries a failed publication for it
- **THEN** the system SHALL use the current connection for the new attempt

#### Scenario: Retry without a connection is refused
- **WHEN** a user retries a failed publication for a platform they are not connected to
- **THEN** the system SHALL refuse and tell them to reconnect first

### Requirement: Retrying an execution retries only its failed platforms

The system SHALL let a user retry an execution, re-running only its failed publications and leaving
the successful ones untouched, then recomputing the overall execution status.

#### Scenario: Execution retry leaves successes alone
- **WHEN** a user retries an execution that partially failed
- **THEN** the system SHALL re-run only the failed publications
- **AND** SHALL recompute the execution status (e.g., PARTIALLY_COMPLETED → COMPLETED on success)

### Requirement: Retry is owner-scoped and manual only

The system SHALL allow retry only by the owner of the execution and SHALL NOT retry automatically;
every retry is user-initiated.

#### Scenario: A user cannot retry another user's publication
- **WHEN** a user attempts to retry a publication in an execution they do not own
- **THEN** the system SHALL refuse and reveal nothing
