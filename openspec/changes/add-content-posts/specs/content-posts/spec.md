## Purpose

Content-posts lets a user create and manage the content they will publish — a required text body
with an optional title and one optional image — scoped to the owner, immutable once created so
publishing history is faithful.

## ADDED Requirements

### Requirement: A user can create a post with text and an optional image

The system SHALL let an authenticated user create a post with required non-empty content, an
optional title, and one optional image. When an image is provided the system SHALL validate its
type and size and store it, recording the image URL and storage id. Empty content SHALL be rejected.

#### Scenario: Post is created with content and image
- **WHEN** a user submits non-empty content and a valid image
- **THEN** the system SHALL create the post and store the image URL and storage id

#### Scenario: Post is created without an image
- **WHEN** a user submits non-empty content and no image
- **THEN** the system SHALL create the post with no image

#### Scenario: Empty content is rejected
- **WHEN** a user submits empty or whitespace-only content
- **THEN** the system SHALL reject the request with a validation error

#### Scenario: Invalid image is rejected
- **WHEN** a user submits a non-image or oversized file
- **THEN** the system SHALL reject the request and create no post

### Requirement: A user can list their own posts

The system SHALL return the authenticated user's posts, excluding soft-deleted ones, with support
for pagination, sorting, and search over content/title. It SHALL NOT return other users' posts.

#### Scenario: Posts are listed with pagination
- **WHEN** a user lists their posts
- **THEN** the system SHALL return their non-deleted posts with pagination metadata

### Requirement: A user can retrieve one of their posts

The system SHALL return a single post by id only when it belongs to the authenticated user.

#### Scenario: Owner retrieves their post
- **WHEN** a user requests a post they own
- **THEN** the system SHALL return it

#### Scenario: Non-owner is refused
- **WHEN** a user requests a post they do not own
- **THEN** the system SHALL respond as not found / forbidden and reveal nothing

### Requirement: A user can delete a post (soft delete)

The system SHALL soft-delete a user's post (mark deleted, retain the record) so that publishing
history referencing it remains readable. A soft-deleted post SHALL NOT appear in the post list.

#### Scenario: Post is soft-deleted
- **WHEN** a user deletes a post they own
- **THEN** the system SHALL mark it deleted and exclude it from listings while retaining the record

### Requirement: Posts are immutable after creation

The system SHALL NOT provide an operation to edit a post's content or image after creation, so the
content shown in publishing history is exactly what was published.

#### Scenario: No edit path exists
- **WHEN** a client attempts to modify an existing post's content
- **THEN** the system SHALL not expose any endpoint that changes it
