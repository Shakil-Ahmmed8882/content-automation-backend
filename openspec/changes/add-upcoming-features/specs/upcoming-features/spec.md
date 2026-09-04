## Purpose

Upcoming-features is an admin-managed catalogue of planned premium capabilities, browsable only by
premium users — so the roadmap is data-driven and the premium area is gated on the backend.

## ADDED Requirements

### Requirement: Administrators can manage upcoming features

The system SHALL let an administrator create, list (all), retrieve, update, and delete upcoming
features, each with a unique slug, title, short and long descriptions, status, sort order, and a
premium-visibility flag.

#### Scenario: Feature is created
- **WHEN** an admin creates a feature with a unique slug and required text
- **THEN** the system SHALL store it and return it

#### Scenario: Duplicate slug is rejected
- **WHEN** an admin creates a feature whose slug already exists
- **THEN** the system SHALL reject the request

#### Scenario: Feature is updated and deleted
- **WHEN** an admin updates or deletes a feature
- **THEN** the system SHALL apply the change

### Requirement: Administrators can set a feature image

The system SHALL let an administrator upload or replace a feature's image, validating type/size,
storing it, and deleting any previously stored image asset.

#### Scenario: Image is set and replaces the old asset
- **WHEN** an admin uploads a valid image for a feature
- **THEN** the system SHALL store it and delete any previously stored image

### Requirement: Premium users can browse the catalogue

The system SHALL let a premium user list the visible upcoming features ordered by sort order and
retrieve one by slug. Each entry SHALL include image, title, short and long descriptions, and status.

#### Scenario: Premium user lists features in order
- **WHEN** a premium user lists upcoming features
- **THEN** the system SHALL return the visible features ordered by sort order

#### Scenario: Premium user views a feature by slug
- **WHEN** a premium user requests a feature by its slug
- **THEN** the system SHALL return that feature's full detail

### Requirement: Non-premium users cannot access the catalogue

The system SHALL deny catalogue browsing to non-premium users, enforced on the backend using the
stored premium status (never a client-supplied flag).

#### Scenario: Non-premium user is denied
- **WHEN** a non-premium user requests the upcoming features
- **THEN** the system SHALL respond 403 Forbidden

### Requirement: Only administrators can manage the catalogue

The system SHALL restrict create/update/delete/image operations to administrators.

#### Scenario: Non-admin cannot manage features
- **WHEN** a non-admin attempts to create or modify a feature
- **THEN** the system SHALL respond 403 Forbidden
