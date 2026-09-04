## Purpose

User-profile lets an authenticated user manage their own account end-to-end — view their profile
(with premium state and linked login providers), update it, manage their avatar image, change
their password, and close their account — always scoped to their own record and never exposing
secrets.

## ADDED Requirements

### Requirement: A user can view their own profile

The system SHALL return the authenticated user's profile: id, name, email, avatar, role, premium
state (`isPremium` and `premiumSince`), the set of linked login providers, and created/updated
timestamps. It SHALL NEVER include password hashes, tokens, or OAuth secrets. Premium state is
read-only here (written only by the payment flow).

#### Scenario: Profile is returned with premium state and providers
- **WHEN** an authenticated user requests their profile
- **THEN** the system SHALL return their profile fields including `isPremium`/`premiumSince` and
  the list of linked providers
- **AND** SHALL omit password hashes and tokens

#### Scenario: Unauthenticated request is rejected
- **WHEN** a profile request has no valid session
- **THEN** the system SHALL respond 401 Unauthorized

### Requirement: A user can update their own editable profile fields

The system SHALL allow the authenticated user to update editable profile fields (name). It SHALL
NOT allow changing the email through this operation (email is the account identity and requires
re-verification elsewhere). Updates SHALL apply only to the caller's own record.

#### Scenario: Name is updated
- **WHEN** an authenticated user submits a valid new name
- **THEN** the system SHALL update their name and return the updated profile

#### Scenario: Email change is not accepted here
- **WHEN** an update request includes an email field
- **THEN** the system SHALL ignore/reject the email change and leave the email unchanged

### Requirement: A user can upload or replace their avatar

The system SHALL accept an image upload, validate its type and size, store it, and record the
image URL and its storage id on the user. WHEN an avatar already exists, the system SHALL delete
the previously stored image so it is not orphaned. Non-image or oversized files SHALL be rejected.

#### Scenario: Avatar is uploaded
- **WHEN** an authenticated user uploads a valid image
- **THEN** the system SHALL store it and set the user's avatar URL and storage id

#### Scenario: Replacing an avatar removes the old asset
- **WHEN** a user who already has an avatar uploads a new valid image
- **THEN** the system SHALL store the new image and delete the previously stored asset

#### Scenario: Invalid file is rejected
- **WHEN** a user uploads a non-image or an oversized file
- **THEN** the system SHALL reject the request with a validation error and change nothing

### Requirement: A user can remove their avatar

The system SHALL allow the authenticated user to remove their avatar, deleting the stored image
and clearing the avatar URL and storage id on their record.

#### Scenario: Avatar is removed
- **WHEN** an authenticated user with an avatar removes it
- **THEN** the system SHALL delete the stored image and clear the avatar fields

### Requirement: A logged-in user can change their password

The system SHALL allow an authenticated user with a credentials login to change their password by
providing their current password and a new password. It SHALL verify the current password before
applying the change, store the new password as a secure hash, and send a confirmation email.
Accounts without a credentials login SHALL be directed to set a password via reset instead.

#### Scenario: Correct current password allows the change
- **WHEN** the user submits the correct current password and a conforming new password
- **THEN** the system SHALL update the password hash and send a confirmation email

#### Scenario: Wrong current password is rejected
- **WHEN** the user submits an incorrect current password
- **THEN** the system SHALL reject the request and leave the password unchanged

#### Scenario: OAuth-only account has no password to change
- **WHEN** a user without a credentials login attempts to change their password
- **THEN** the system SHALL reject the request and indicate they must set a password via reset

### Requirement: A user can delete their own account (soft delete)

The system SHALL allow the authenticated user to delete their own account as a soft delete:
marking it deleted, retaining the record and its email as reserved, and ending the current
session. A soft-deleted user SHALL NOT be able to authenticate afterward.

#### Scenario: Account is soft-deleted and session ends
- **WHEN** an authenticated user deletes their account
- **THEN** the system SHALL mark the account deleted, reserve its email, and clear the session

#### Scenario: Deleted user cannot log in
- **WHEN** a soft-deleted user attempts to log in afterward
- **THEN** the system SHALL refuse the login

### Requirement: Every profile operation is owner-scoped

The system SHALL apply all profile operations only to the authenticated caller's own record. A
user SHALL NEVER be able to read or modify another user's profile through this capability.

#### Scenario: Operations target only the caller
- **WHEN** any profile read or write is performed
- **THEN** the system SHALL resolve the target strictly from the authenticated session, not from
  client-supplied identifiers
