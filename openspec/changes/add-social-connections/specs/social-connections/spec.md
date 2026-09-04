## Purpose

Social-connections manages a user's LinkedIn and Facebook Page publishing accounts end-to-end —
connecting via OAuth, selecting a Facebook Page, listing connections, and disconnecting — storing
only encrypted credentials needed to publish, scoped to the owning user.

## ADDED Requirements

### Requirement: A user can start connecting a LIVE platform

The system SHALL let an authenticated user begin connecting a platform by redirecting to that
platform's OAuth authorization flow, only when the platform's status is LIVE. It SHALL issue and
record an anti-forgery `state` value tied to the user for validation on return.

#### Scenario: Connect begins for a LIVE platform
- **WHEN** a user starts connecting a LIVE platform
- **THEN** the system SHALL direct them to the platform's OAuth flow with a recorded `state`

#### Scenario: Connecting a non-LIVE platform is refused
- **WHEN** a user starts connecting a platform whose status is not LIVE
- **THEN** the system SHALL refuse the request

### Requirement: The OAuth callback stores an encrypted connection

The system SHALL handle the platform's OAuth callback by validating the returned `state`,
exchanging the authorization code for access (and refresh, where provided) tokens, and storing a
connection for the user with the platform account identity and name. Tokens MUST be encrypted at
rest and MUST NEVER be returned to any client. An invalid or missing `state` SHALL be rejected.

#### Scenario: Valid callback creates an encrypted connection
- **WHEN** a valid callback with a matching `state` completes for a user
- **THEN** the system SHALL store the connection with encrypted tokens and the account identity

#### Scenario: Invalid state is rejected
- **WHEN** a callback arrives with a missing or mismatched `state`
- **THEN** the system SHALL reject it and store nothing

### Requirement: A user selects which Facebook Page to publish to

WHEN connecting Facebook and the user administers more than one Page, the system SHALL present the
available Pages and store the connection only for the Page the user selects, using that Page's
access token. When exactly one Page is available it MAY be selected automatically.

#### Scenario: User selects a Page among several
- **WHEN** a user with multiple Facebook Pages selects one
- **THEN** the system SHALL store the connection for that Page using its Page access token

### Requirement: A user can list their connections without exposing tokens

The system SHALL return the authenticated user's connections with platform, account name, status,
and expiry. It SHALL NEVER include access or refresh tokens.

#### Scenario: Connections are listed without secrets
- **WHEN** a user lists their connections
- **THEN** the system SHALL return each connection's platform and account name
- **AND** SHALL omit all tokens

### Requirement: A user can disconnect a platform

The system SHALL let a user disconnect a platform, **hard-deleting** the connection so the stored
credentials are physically removed. Past publications that used it SHALL remain readable via their
own snapshot.

#### Scenario: Disconnect removes the credential
- **WHEN** a user disconnects a connected platform
- **THEN** the system SHALL delete the connection record and its stored tokens

### Requirement: A user has at most one connection per platform

The system SHALL allow at most one connection per platform per user. Reconnecting SHALL replace the
existing connection rather than create a duplicate.

#### Scenario: Reconnecting replaces the existing connection
- **WHEN** a user connects a platform they are already connected to
- **THEN** the system SHALL end with exactly one connection for that platform

### Requirement: Connection operations are owner-scoped

The system SHALL scope every connection operation to the authenticated user; a user SHALL NEVER
read or delete another user's connection.

#### Scenario: Operations target only the caller's connections
- **WHEN** any connection read or delete is performed
- **THEN** the system SHALL resolve it strictly from the authenticated session
