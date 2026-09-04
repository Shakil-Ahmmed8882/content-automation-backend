## Purpose

Platform-catalogue lets administrators manage the set of publishing platforms (name, logo,
availability, ordering) as data, and lets users see the list of active platforms to connect and
publish to — so new platforms are added without code changes.

## ADDED Requirements

### Requirement: Administrators can create a platform

The system SHALL let an administrator create a platform with a unique `key`, a display `name`, a
`status` of LIVE or COMING_SOON, a sort order, and an active flag. The `key` MUST be unique and is
the stable identifier the backend uses to select the platform's integration.

#### Scenario: Platform is created
- **WHEN** an admin submits a new platform with a unique key and a name
- **THEN** the system SHALL create it and return it

#### Scenario: Duplicate key is rejected
- **WHEN** an admin submits a platform whose key already exists
- **THEN** the system SHALL reject the request

### Requirement: Administrators can view and list all platforms

The system SHALL let an administrator list all platforms, including inactive ones, and retrieve a
single platform by id.

#### Scenario: Admin lists every platform
- **WHEN** an admin requests the platform list
- **THEN** the system SHALL return all platforms regardless of active state

### Requirement: Administrators can update a platform

The system SHALL let an administrator update a platform's name, status, sort order, and active
flag.

#### Scenario: Platform fields are updated
- **WHEN** an admin updates a platform's editable fields with valid values
- **THEN** the system SHALL persist the changes and return the updated platform

### Requirement: Administrators can set a platform logo

The system SHALL let an administrator upload or replace a platform's logo image, validating its
type and size, storing the image, and recording its URL and storage id. Replacing a logo SHALL
delete the previously stored asset.

#### Scenario: Logo is uploaded and replaces the old asset
- **WHEN** an admin uploads a valid logo image for a platform
- **THEN** the system SHALL store it, set the platform's logo URL and storage id, and delete any
  previously stored logo asset

### Requirement: Platforms are retired rather than hard-deleted

The system SHALL retire a platform by deactivating it (active flag off) instead of deleting the
record, so that connections and publications referencing it remain valid.

#### Scenario: Retiring hides a platform but preserves references
- **WHEN** an admin deactivates a platform
- **THEN** the system SHALL exclude it from the user-facing active list
- **AND** SHALL keep the record so existing references remain valid

### Requirement: Users can list active platforms

The system SHALL return to any authenticated user the list of active platforms ordered by sort
order, for use in the connect and publish pickers. Inactive platforms SHALL NOT appear.

#### Scenario: Active platforms are listed in order
- **WHEN** an authenticated user requests the platform list
- **THEN** the system SHALL return only active platforms ordered by sort order

### Requirement: Only administrators manage the catalogue

The system SHALL restrict all create/update/logo/retire operations to administrators; a
non-admin SHALL be forbidden.

#### Scenario: Non-admin cannot mutate the catalogue
- **WHEN** a non-admin user attempts to create or modify a platform
- **THEN** the system SHALL respond 403 Forbidden
