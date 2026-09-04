## Purpose

Publishing turns one post into a backend-executed publish across the user's selected connected
platforms — fanning out to a per-platform publication with an attempts ledger, running in the
background so the browser can close, and recording per-platform and overall status.

## ADDED Requirements

### Requirement: A user can start publishing a post to selected connected platforms

The system SHALL let a user publish one of their posts to one or more selected platforms. It SHALL
validate that the post belongs to the user and is not deleted, that its content is present, that at
least one platform is selected, and that each selected platform is currently connected. If a
selected platform is not connected, the system SHALL refuse and indicate which platform must be
connected first.

#### Scenario: Publish starts for connected platforms
- **WHEN** a user publishes their post to platforms they are connected to
- **THEN** the system SHALL create an execution and accept the request

#### Scenario: Publishing to an unconnected platform is refused
- **WHEN** a selected platform is not connected
- **THEN** the system SHALL refuse and name the platform to connect first

#### Scenario: Empty selection is refused
- **WHEN** no platform is selected
- **THEN** the system SHALL reject the request

### Requirement: Publishing executes in the background

The system SHALL perform the actual publishing outside the request/response cycle and SHALL return
promptly indicating the execution has started, with an execution identifier. The publish SHALL
continue even if the client disconnects, refreshes, or navigates away.

#### Scenario: The request returns before publishing completes
- **WHEN** a user starts a publish
- **THEN** the system SHALL respond that it has started and return the execution id
- **AND** SHALL continue publishing in the background regardless of the client

### Requirement: An execution fans out to one publication per platform

The system SHALL create, under the execution, exactly one publication per selected platform, each
recording the platform and a snapshot of the connection's account name so history stays readable if
the connection is later removed.

#### Scenario: One publication per selected platform
- **WHEN** a user publishes to two platforms
- **THEN** the system SHALL create two publications under the execution, each with its platform and
  account-name snapshot

### Requirement: Each platform publish is recorded as an attempt

The system SHALL record every publish try as an attempt under its publication (the first publish is
attempt #1). On success it SHALL store the external post id (and url if provided) and mark the
publication successful; on failure it SHALL store the failure reason and mark the publication failed.

#### Scenario: Successful publish records the external reference
- **WHEN** a platform accepts the post
- **THEN** the system SHALL record a successful attempt with the external post id and mark the
  publication SUCCESS

#### Scenario: Failed publish records the reason
- **WHEN** a platform rejects the post (e.g., expired token)
- **THEN** the system SHALL record a failed attempt with the reason and mark the publication FAILED

### Requirement: Overall execution status is computed from the publications

The system SHALL compute the execution's overall status from its publications: all succeeded →
COMPLETED; some succeeded and some failed → PARTIALLY_COMPLETED; all failed → FAILED; while work
remains → RUNNING.

#### Scenario: Mixed results yield partial completion
- **WHEN** one platform succeeds and another fails in the same execution
- **THEN** the system SHALL set the execution status to PARTIALLY_COMPLETED

### Requirement: Publishing is owner-scoped and never leaks secrets

The system SHALL only publish posts owned by the requesting user, using only that user's
connections, and SHALL NEVER expose tokens or internal stack traces in stored reasons or responses.

#### Scenario: A user cannot publish another user's post
- **WHEN** a user attempts to publish a post they do not own
- **THEN** the system SHALL refuse and reveal nothing
