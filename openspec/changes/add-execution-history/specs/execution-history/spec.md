## Purpose

Execution-history lets a user review their publishing runs — a paginated list of executions and a
per-execution detail showing each platform's outcome, external links, and failure reasons — scoped
to the owner and read-only.

## ADDED Requirements

### Requirement: A user can list their executions

The system SHALL return the authenticated user's executions with the content reference/title, the
targeted platforms, the overall status, and the started/completed times. The list SHALL support
pagination, sorting, and filtering by status and date, and SHALL exclude other users' executions.

#### Scenario: Executions are listed with status and dates
- **WHEN** a user lists their executions
- **THEN** the system SHALL return their executions with overall status and timing, paginated

#### Scenario: Filtering by status
- **WHEN** a user filters the list by a status (e.g., PARTIALLY_COMPLETED)
- **THEN** the system SHALL return only executions with that status

### Requirement: A user can view an execution's per-platform detail

The system SHALL return, for one of the user's executions, the content and each platform's result:
publication status, the external post url on success, the failure reason on failure, and the
published time. It SHALL indicate which platforms failed (and are therefore retryable).

#### Scenario: Detail shows per-platform results
- **WHEN** a user opens an execution they own
- **THEN** the system SHALL return the content and each platform's status, external url (if any),
  and failure reason (if any)

#### Scenario: Failed platforms are identifiable for retry
- **WHEN** an execution has a failed platform
- **THEN** the detail SHALL identify that platform as failed so the client can offer Retry

### Requirement: History is owner-scoped and reveals no secrets

The system SHALL only return executions owned by the requesting user, and the reasons shown SHALL
be the stored sanitized messages — never tokens or internal stack traces.

#### Scenario: A user cannot view another user's execution
- **WHEN** a user requests an execution they do not own
- **THEN** the system SHALL respond as not found / forbidden and reveal nothing

#### Scenario: Content remains visible after the post is deleted
- **WHEN** a user views history for a post they later soft-deleted
- **THEN** the system SHALL still show the content that was published
