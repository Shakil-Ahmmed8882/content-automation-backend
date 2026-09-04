## Purpose

Admin-audit gives administrators the tools to manage and moderate users (list, block, change role,
comp premium) and records sensitive actions across the system in an append-only audit log that
admins can review.

## ADDED Requirements

### Requirement: Administrators can list and view users

The system SHALL let an administrator list users with pagination and search, and retrieve a single
user's detail. Listing SHALL NOT expose password hashes or tokens.

#### Scenario: Admin lists users
- **WHEN** an admin lists users
- **THEN** the system SHALL return users with pagination, omitting secrets

### Requirement: Administrators can block and unblock users

The system SHALL let an administrator block or unblock a user, and a blocked user SHALL be unable to
authenticate until unblocked.

#### Scenario: Blocking prevents login
- **WHEN** an admin blocks a user
- **THEN** the system SHALL set the user blocked and refuse that user's subsequent logins

#### Scenario: Unblocking restores access
- **WHEN** an admin unblocks a previously blocked user
- **THEN** the system SHALL allow that user to log in again

### Requirement: Super-admins can change a user's role

The system SHALL let a super-admin change a user's role. A non-super-admin SHALL NOT be able to
change roles.

#### Scenario: Super-admin changes a role
- **WHEN** a super-admin changes a user's role
- **THEN** the system SHALL update the role

#### Scenario: Non-super-admin cannot change roles
- **WHEN** an admin (not super-admin) attempts to change a role
- **THEN** the system SHALL respond 403 Forbidden

### Requirement: Administrators can grant or revoke premium

The system SHALL let an administrator grant or revoke a user's premium status directly (independent
of any payment), for comps and support.

#### Scenario: Admin comps premium
- **WHEN** an admin grants premium to a user
- **THEN** the system SHALL set that user premium without requiring a payment

### Requirement: Sensitive actions are recorded in an append-only audit log

The system SHALL record sensitive actions (at least: user block/unblock, role change, premium
grant/revoke, connection disconnect, verified payment, and catalogue changes) as audit entries
capturing the actor, action, affected entity, and relevant metadata. Audit entries SHALL be
append-only — never modified or deleted — and SHALL contain no secrets.

#### Scenario: A sensitive action writes an audit entry
- **WHEN** an admin blocks a user
- **THEN** the system SHALL append an audit entry with the actor, the action, and the affected user

#### Scenario: Audit entries are immutable
- **WHEN** any audit entry exists
- **THEN** the system SHALL provide no operation to edit or delete it

### Requirement: Administrators can review the audit log

The system SHALL let an administrator list and filter audit entries (by actor, action, or affected
entity) with pagination.

#### Scenario: Admin filters the audit log
- **WHEN** an admin lists the audit log filtered by action
- **THEN** the system SHALL return matching entries, paginated

### Requirement: Administration is restricted and reveals no secrets

The system SHALL restrict all administration to administrators (role changes to super-admins) and
SHALL never expose password hashes, tokens, or gateway secrets through admin views or audit metadata.

#### Scenario: Non-admin cannot access administration
- **WHEN** a non-admin calls any admin endpoint
- **THEN** the system SHALL respond 403 Forbidden
