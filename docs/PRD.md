# PRD — Content Automation Platform

**Version:** 1.0  
**Status:** MVP Single Source of Truth  
**Audience:** Developer / Cloud Code implementation agent  
**Implementation principle:** Build the MVP completely before extending it.

---

# 1. Product Summary

## 1.1 Product concept

Build a focused content automation application based on:

> **Write once → publish to multiple platforms.**

A user creates a piece of content with text and an image, connects social accounts, selects the platforms, and publishes it. The backend executes the publishing workflow independently in the background and records the result.

The initial supported publishing platforms are:

- LinkedIn
- Facebook Page

The MVP must be simple enough to finish quickly but architected so future automation capabilities can be added without redesigning the entire system.

## 1.2 What this product is NOT

The MVP is not:

- A generic n8n clone
- A general-purpose workflow marketplace
- A team collaboration platform
- A full social media management suite
- An AI-first application
- A scheduling platform

Those may become future capabilities.

---

# 2. Product Goals

## MVP goals

1. Allow a user to create an account.
2. Allow login with credentials.
3. Allow Google authentication.
4. Allow the user to connect LinkedIn.
5. Allow the user to connect a Facebook Page.
6. Allow the user to create text content and upload an image.
7. Allow the user to select publishing platforms.
8. Allow the user to publish immediately.
9. Execute publishing on the backend.
10. Do not require the browser to remain open during execution.
11. Show the user the publishing workflow.
12. Store execution history and per-platform status.
13. Allow failed platform executions to be manually retried.
14. Provide payment integration.
15. Mark a successfully paid user as Premium.
16. Show Premium users an Upcoming Features area.

## Non-goals for MVP

Do not implement:

- Scheduled publishing
- AI rewriting
- AI image generation
- Instagram/TikTok/YouTube/X publishing
- User-editable workflow nodes
- Workflow branching
- Conditions
- Team/workspace functionality
- Advanced analytics
- Content approval workflows
- Content templates
- Complex subscription management

---

# 3. Target User

The primary MVP user is an individual creator, developer, marketer, freelancer, or small business owner who wants to publish the same content to multiple social platforms without manually repeating the work.

The system is single-user oriented.

There is no workspace/team model in MVP.

---

# 4. Core User Journey

## 4.1 New user

```text
Landing Page
    ↓
Register
    ↓
Email verification if required by implementation
    ↓
Login
    ↓
Dashboard
    ↓
Connect LinkedIn / Facebook
    ↓
Create Content
    ↓
Add Image
    ↓
Select Platforms
    ↓
Publish Now
    ↓
Publishing Workflow Starts
    ↓
Background Execution
    ↓
Execution Result
```

## 4.2 Existing user

```text
Login
    ↓
Dashboard
    ↓
Create Content
    ↓
Select Platforms
    ↓
Publish Now
    ↓
Background Workflow
    ↓
Result
```

## 4.3 Premium user

```text
Successful Payment
    ↓
User becomes Premium
    ↓
Crown Badge appears
    ↓
Upcoming Features becomes available
```

---

# 5. Application Information Architecture

Keep the navigation intentionally small.

## Main routes

```text
/
├── login
├── register
├── forgot-password
├── reset-password
│
└── app
    ├── dashboard
    ├── create
    ├── connections
    ├── executions
    ├── profile
    ├── payment
    └── upcoming-features
```

Route naming may be adapted to the final frontend framework conventions, but the product concepts must remain.

## Sidebar

MVP sidebar:

- Dashboard
- Create Post
- Connections
- Executions
- Profile

Premium users additionally see:

- Upcoming Features

Payment/upgrade can be accessed from Profile or a dedicated Premium/Upgrade entry.

---

# 6. Authentication

## 6.1 Credential authentication

Support:

- Register with email/password
- Login with email/password
- Forgot password
- Reset password
- Logout

Password storage must use secure password hashing.

Never store plaintext passwords.

## 6.2 Google authentication

Support Google OAuth as an authentication provider.

The authentication architecture should allow additional providers later without redesign.

Potential future providers:

- Facebook
- GitHub
- Others

Do not implement them in MVP.

## 6.3 Authentication API requirements

Only create endpoints actually needed.

Suggested minimum:

```text
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/forgot-password
POST   /api/auth/reset-password
POST   /api/auth/logout
GET    /api/auth/me
GET    /api/auth/google
GET    /api/auth/google/callback
```

If the selected authentication implementation handles some operations internally, do not create redundant custom endpoints.

---

# 7. User Profile

Each user should have a simple profile containing:

- id
- name
- email
- avatar
- authentication provider information
- premium status
- createdAt
- updatedAt

Premium state should be represented explicitly.

Example:

```text
isPremium: true
```

or an equivalent subscription/status model.

## Premium badge

After successful payment, show a small crown badge near the user's profile identity.

The badge should communicate:

> Premium

Do not build a complicated membership system in MVP.

---

# 8. Social Connections

## 8.1 LinkedIn

The user can:

1. Click Connect LinkedIn.
2. Authorize through LinkedIn OAuth.
3. Return to the application.
4. See LinkedIn as connected.
5. Publish content through the connected account.

Store only the tokens/data required to perform authorized publishing.

Tokens must be handled securely.

## 8.2 Facebook

For MVP, Facebook publishing should target a Facebook Page rather than a personal Facebook profile.

The user can:

1. Click Connect Facebook.
2. Authorize through Facebook.
3. Select an available Page if required.
4. Store the necessary authorization information.
5. See the Page as connected.
6. Publish content to that Page.

## 8.3 Connection UI

Each connection should show:

```text
LinkedIn
Connected ✓
[Disconnect]

Facebook Page
Connected ✓
[Disconnect]
```

If disconnected:

```text
LinkedIn
Not connected
[Connect]
```

## 8.4 Connection APIs

Minimum required operations:

```text
GET    /api/connections
GET    /api/connections/linkedin/connect
GET    /api/connections/linkedin/callback
DELETE /api/connections/linkedin

GET    /api/connections/facebook/connect
GET    /api/connections/facebook/callback
DELETE /api/connections/facebook
```

Exact OAuth callback routes may vary depending on implementation.

---

# 9. Content Creation

## 9.1 MVP content

A post contains:

- Text/content
- Optional image
- Selected publishing platforms

Example:

```text
Content:
"We just launched our new product..."

Image:
product-launch.png

Platforms:
[x] LinkedIn
[x] Facebook
```

## 9.2 Image

MVP supports one image per post.

The image must:

- Be uploaded before publishing.
- Be validated for allowed file types.
- Have a reasonable file-size limit.
- Be stored in an appropriate object/media storage service.
- Have a persistent URL/reference usable by the publishing workers.

Do not build a full media library in MVP.

## 9.3 Validation

Required:

- Content cannot be empty.
- At least one platform must be selected.
- Image must satisfy file validation rules when provided.
- Connected account must exist before publishing to that platform.

---

# 10. Publishing

## 10.1 Publish Now

MVP supports immediate publishing only.

The user clicks:

```text
Publish
```

The frontend should not perform the entire publishing process itself.

Instead:

```text
Frontend
   ↓
Create publishing execution
   ↓
Backend
   ↓
Background worker/job
   ↓
LinkedIn / Facebook
```

## 10.2 User feedback

After clicking Publish:

```text
Publishing started.
You can leave this page.
```

The user should not be forced to keep the browser open.

## 10.3 Publishing result

Each platform must have its own result.

Example:

```text
LinkedIn    ✓ Published
Facebook    ✓ Published
```

Partial success:

```text
LinkedIn    ✓ Published
Facebook    ✕ Failed
```

The execution must retain enough information to explain the failure.

---

# 11. Workflow

The workflow is the core engineering concept.

## 11.1 MVP visible workflow

The user can SEE the workflow.

The workflow should visually communicate:

```text
START
  ↓
PREPARE CONTENT
  ↓
PUBLISH TO LINKEDIN
  ↓
PUBLISH TO FACEBOOK
  ↓
END
```

The exact visual implementation can use React Flow.

## 11.2 Important MVP limitation

The workflow is visible but **not user-editable** in MVP.

Do not build:

- drag/drop workflow construction
- arbitrary node insertion
- branching
- conditions
- custom ordering

The internal workflow engine should nevertheless be designed around reusable steps/nodes where practical.

This allows future features to extend the same foundation.

---

# 12. Background Execution

This is a critical requirement.

Once the user starts publishing:

```text
HTTP request
    ↓
Create execution
    ↓
Queue/background job
    ↓
Return "started"
```

The actual execution happens independently.

The browser may be:

- closed
- refreshed
- navigated away

and the backend must continue the execution.

## Execution lifecycle

Suggested states:

```text
PENDING
RUNNING
PARTIALLY_COMPLETED
COMPLETED
FAILED
```

Per-platform status can be:

```text
PENDING
RUNNING
SUCCESS
FAILED
```

## Execution sequence

Example:

```text
START
 ↓
Prepare content
 ↓
Publish LinkedIn
 ↓
Publish Facebook
 ↓
END
```

If LinkedIn succeeds but Facebook fails:

```text
LinkedIn = SUCCESS
Facebook = FAILED
Execution = PARTIALLY_COMPLETED
```

---

# 13. Retry

MVP supports manual retry.

Example:

```text
Facebook
Failed

[Retry]
```

Retry only the failed platform/step where practical.

Do not automatically retry indefinitely.

Future versions can introduce:

- automatic retry
- exponential backoff
- dead-letter queues
- failure recovery
- configurable retry policies

---

# 14. Execution History

The user can open the Executions page.

Each execution should show:

- Content reference/title or shortened content
- Selected platforms
- Overall status
- Started time
- Completed time if finished
- Platform statuses

Example:

| Content | LinkedIn | Facebook | Status | Date |
|---|---|---|---|---|
| Product launch... | Success | Success | Completed | Today |
| New announcement... | Success | Failed | Partial | Yesterday |

A detail page/panel can show:

```text
Execution #123

Content
"New product launch..."

LinkedIn
✓ Published
Published at 10:32

Facebook
✕ Failed
Reason: ...

[Retry Facebook]
```

---

# 15. Payment

Payment exists in MVP primarily as an assignment requirement and as the foundation for future premium capabilities.

## Payment journey

```text
Profile / Upgrade
      ↓
Payment
      ↓
Payment success
      ↓
User becomes Premium
      ↓
Crown badge
      ↓
Upcoming Features unlocked
```

Use a payment provider appropriate to the assignment/environment.

The implementation must verify payment success on the backend.

Do not trust a frontend-only "payment successful" flag.

## Payment requirements

Store enough information to establish:

- user
- payment reference
- provider
- amount
- currency
- status
- transaction/reference ID
- timestamps

Suggested statuses:

```text
PENDING
SUCCESS
FAILED
CANCELLED
```

## Payment API

Only create what the chosen provider requires.

Typical application-level operations:

```text
POST /api/payments/create
POST /api/payments/verify
GET  /api/payments/status
```

If the provider uses a webhook/callback:

```text
POST /api/payments/webhook
```

The exact payment endpoints depend on the selected provider.

---

# 16. Premium / Upcoming Features

The MVP does not implement the future premium capabilities.

Instead, it provides a Premium-only catalogue of planned capabilities.

## Access

Non-premium users should not access the full Premium Upcoming Features area.

Premium users see:

```text
Crown Premium
```

and:

```text
Upcoming Features
```

## Feature card

Each feature should contain:

- Image/icon
- Title
- Short description
- Detailed description
- Status

Example:

```text
AI Content Enhancement

Write rough content and let AI improve the
writing before you publish.

Coming Soon
```

## Initial upcoming features

### 1. AI Content Enhancement

```text
Rough content
    ↓
AI improves writing
    ↓
User reviews
    ↓
User approves
    ↓
Publish
```

### 2. Scheduled Publishing

Create content now and publish it automatically at a future date/time.

### 3. More Social Platforms

Extend beyond LinkedIn and Facebook.

Potential integrations:

- Instagram
- X
- YouTube
- TikTok
- Others where supported

### 4. Platform-Specific Content

Generate/customize versions for each platform.

Example:

```text
Original
   ↓
LinkedIn version
Facebook version
Instagram version
```

### 5. Approval Workflow

Allow content to move through:

```text
Draft
 ↓
Review
 ↓
Approved
 ↓
Published
```

### 6. Content Calendar

Visualize:

- Published content
- Scheduled content
- Drafts
- Upcoming posts

### 7. Analytics

Show publishing/performance information from supported platforms where APIs permit it.

### 8. Automatic Retry & Recovery

Automatically retry temporary publishing failures with controlled retry policies.

### 9. AI Image Generation

Generate an image based on the user's content.

### 10. Content Templates

Save reusable post structures.

### 11. Team / Workspace

Move from:

```text
One user
```

to:

```text
Workspace
 ├── Members
 ├── Roles
 ├── Permissions
 └── Shared content
```

### 12. Advanced Workflow Builder

Allow users to edit the workflow:

```text
START
 ↓
AI
 ↓
Approval
 ↓
Condition
 ├── TRUE → LinkedIn
 └── FALSE → Review
```

This is the long-term automation engine.

---

# 17. Upcoming Feature Data Model

The feature catalogue should be data-driven rather than hardcoded into UI components.

Example conceptual model:

```text
UpcomingFeature
----------------
id
title
slug
image
shortDescription
description
status
sortOrder
isPremiumVisible
createdAt
updatedAt
```

Possible status values:

```text
COMING_SOON
IN_DEVELOPMENT
PLANNED
```

This allows new future features to be added without rewriting the frontend.

---

# 18. MVP API Surface

Do NOT create APIs merely to reach a number.

The API count is secondary to the product.

A reasonable MVP surface is approximately:

## Authentication

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/forgot-password
POST /api/auth/reset-password
POST /api/auth/logout
GET  /api/auth/me
```

Plus Google OAuth routes.

## Profile

```text
GET /api/users/me
PATCH /api/users/me
```

## Connections

```text
GET    /api/connections
GET    /api/connections/linkedin/connect
GET    /api/connections/linkedin/callback
DELETE /api/connections/linkedin

GET    /api/connections/facebook/connect
GET    /api/connections/facebook/callback
DELETE /api/connections/facebook
```

## Content

```text
POST /api/posts
GET  /api/posts
GET  /api/posts/:id
DELETE /api/posts/:id
```

If post persistence is unnecessary for the chosen implementation, do not add redundant CRUD.

## Publishing / Execution

```text
POST /api/posts/:id/publish
GET  /api/executions
GET  /api/executions/:id
POST /api/executions/:id/retry
```

## Payment

Provider-dependent:

```text
POST /api/payments/create
POST /api/payments/verify
GET  /api/payments/status
POST /api/payments/webhook
```

## Upcoming Features

```text
GET /api/upcoming-features
GET /api/upcoming-features/:slug
```

These APIs should be adjusted during implementation based on actual requirements. **Do not implement duplicate endpoints just because an example list contains them.**

---

# 19. Suggested Data Model

The exact schema is an implementation decision, but the system should conceptually contain:

## User

```text
User
- id
- name
- email
- passwordHash (nullable for OAuth-only users)
- avatar
- authProvider
- isPremium
- createdAt
- updatedAt
```

## SocialConnection

```text
SocialConnection
- id
- userId
- platform
- platformAccountId
- platformAccountName
- accessToken / encrypted credential reference
- refreshToken / encrypted credential reference if applicable
- expiresAt
- metadata
- createdAt
- updatedAt
```

## Post

```text
Post
- id
- userId
- content
- imageUrl
- createdAt
- updatedAt
```

## PostPlatform / Publication

```text
Publication
- id
- postId
- platform
- connectionId
- status
- externalPostId
- errorMessage
- publishedAt
- createdAt
- updatedAt
```

## Execution

```text
Execution
- id
- postId
- userId
- status
- startedAt
- completedAt
- createdAt
- updatedAt
```

## Payment

```text
Payment
- id
- userId
- provider
- amount
- currency
- status
- transactionId
- providerReference
- createdAt
- updatedAt
```

## UpcomingFeature

```text
UpcomingFeature
- id
- title
- slug
- image
- shortDescription
- description
- status
- sortOrder
- isPremiumVisible
- createdAt
- updatedAt
```

The actual schema may combine/split models when technically justified.

---

# 20. Frontend Requirements

## Dashboard

Keep it simple.

Show:

- Welcome/profile area
- Premium status if applicable
- Connected platforms
- Quick Create Post action
- Recent executions
- Basic publishing statistics if trivial to provide

Do not build a complex analytics dashboard.

## Create Post

The primary action screen.

Components:

```text
Content textarea
Image uploader
Platform selector
Preview
Publish button
```

Example:

```text
Create Post

[ Write your content here... ]

[ Upload Image ]

Publish to:
[x] LinkedIn
[x] Facebook

[ Publish Now ]
```

## Connections

Simple connection cards.

## Executions

Simple list/table + details.

## Profile

Show:

- User information
- Authentication information where appropriate
- Premium badge
- Payment/upgrade entry
- Logout

## Upcoming Features

Premium-only.

Use a visually attractive but restrained design.

Cards should include image, title, description, and details.

---

# 21. UX Requirements

The application should feel:

- Simple
- Modern
- Clear
- Fast
- Professional

Avoid:

- Excessive configuration
- Unnecessary modals
- Complex dashboards
- Too many navigation items
- Features that are not functional

Every primary action should have clear feedback.

Examples:

```text
Publishing started.
```

```text
Published successfully.
```

```text
LinkedIn published successfully, but Facebook failed.
```

```text
Payment successful. Welcome to Premium.
```

---

# 22. Error Handling

Use a consistent backend error response.

Conceptually:

```json
{
  "success": false,
  "message": "Human readable message",
  "errorDetails": null
}
```

Validation errors can include structured field-level details.

Frontend must show useful messages rather than raw server errors.

Examples:

- "Please enter some content."
- "Connect LinkedIn before publishing."
- "Facebook connection has expired. Please reconnect."
- "Publishing failed. You can retry."

Never expose:

- access tokens
- refresh tokens
- password hashes
- internal stack traces

to the client.

---

# 23. Security Requirements

Minimum requirements:

- Hash passwords securely.
- Authenticate protected APIs.
- Authorize resources by current user.
- Never allow one user to access another user's posts/executions/connections.
- Encrypt or securely protect OAuth credentials/tokens.
- Validate uploads.
- Validate request bodies.
- Validate OAuth state.
- Verify payment callbacks/webhooks server-side.
- Never trust frontend premium status.
- Use environment variables for secrets.
- Never commit secrets.

---

# 24. Background Job Architecture

The backend should separate:

**API request**

from

**long-running publishing execution.**

Conceptually:

```text
Client
  ↓
POST /posts/:id/publish
  ↓
API validates request
  ↓
Create Execution
  ↓
Create background job
  ↓
Return 202 / started
       │
       └──────────────→ Worker
                         ↓
                    Prepare content
                         ↓
                    LinkedIn publish
                         ↓
                    Facebook publish
                         ↓
                    Update statuses
                         ↓
                    Complete execution
```

A queue system such as Redis + BullMQ can be used if appropriate.

The implementation should not use a fragile in-memory timer as the primary production execution mechanism.

---

# 25. Workflow Engine Design

Even though the MVP workflow is fixed, represent execution steps in a reusable way.

Conceptually:

```text
Workflow
  ├── StartNode
  ├── PrepareContentNode
  ├── LinkedInPublishNode
  ├── FacebookPublishNode
  └── EndNode
```

Each node should have a clear responsibility.

Future node types may include:

```text
AI
DELAY
APPROVAL
CONDITION
IMAGE_GENERATION
SCHEDULER
EMAIL
```

Do not implement these future nodes in MVP.

---

# 26. React Flow Requirements

Use React Flow for the visible workflow.

MVP should render a predefined graph.

Required visual nodes:

```text
START
PREPARE CONTENT
LINKEDIN
FACEBOOK
END
```

Connections should be visually obvious.

The workflow should be read-only in MVP.

Later, React Flow can become an actual workflow editor.

---

# 27. Publishing Provider Abstraction

Do not scatter LinkedIn/Facebook-specific publishing logic throughout the application.

Use an integration abstraction.

Conceptually:

```text
SocialPublisher
    ├── LinkedInPublisher
    └── FacebookPublisher
```

A common interface should make future integrations possible.

Conceptually:

```text
publish(content, image, connection)
```

Future:

```text
InstagramPublisher
XPublisher
YouTubePublisher
TikTokPublisher
```

can implement the same contract where their APIs permit the operation.

---

# 28. Future Architecture

The MVP should be designed so future capabilities can be added incrementally.

Long-term:

```text
                    ┌── LinkedIn
                    ├── Facebook
                    ├── Instagram
                    ├── X
                    └── YouTube

Content → Workflow ─┤
                    ├── AI Enhancement
                    ├── Scheduler
                    ├── Approval
                    ├── Condition
                    └── Analytics
```

The workflow engine becomes the reusable core.

---

# 29. Premium Feature Roadmap

The following roadmap is intentionally documented now but should not be implemented unless moved into MVP scope.

## Phase 2

- AI content improvement
- Scheduled publishing
- Better execution retry
- Additional social platform

## Phase 3

- Platform-specific content
- Content calendar
- Templates
- Analytics

## Phase 4

- Approval workflow
- Advanced React Flow editor
- Conditions/branching
- AI image generation

## Phase 5

- Teams/workspaces
- Roles/permissions
- Collaboration
- Advanced automation marketplace/integrations

This roadmap is not a commitment to exact dates.

---

# 30. MVP Acceptance Criteria

The MVP is considered complete when all of the following work end-to-end.

## Authentication

- [ ] User can register with email/password.
- [ ] User can log in.
- [ ] User can log out.
- [ ] User can recover/reset password.
- [ ] User can authenticate using Google.
- [ ] Protected routes require authentication.

## Connections

- [ ] User can connect LinkedIn.
- [ ] User can disconnect LinkedIn.
- [ ] User can connect Facebook Page.
- [ ] User can disconnect Facebook.
- [ ] Connection state is persisted.

## Content

- [ ] User can enter content.
- [ ] User can upload an image.
- [ ] User can select LinkedIn.
- [ ] User can select Facebook.
- [ ] User cannot publish empty content.
- [ ] User cannot publish to an unconnected platform.

## Publishing

- [ ] User can click Publish Now.
- [ ] Backend creates an execution.
- [ ] Background execution starts.
- [ ] User can leave the page.
- [ ] LinkedIn publication works.
- [ ] Facebook publication works.
- [ ] Each platform has an independent status.
- [ ] Overall execution status is calculated correctly.
- [ ] Errors are persisted.
- [ ] Failed publication can be manually retried.

## Workflow

- [ ] React Flow displays the workflow.
- [ ] Start and End are visible.
- [ ] Content preparation is visible.
- [ ] LinkedIn and Facebook steps are visible.
- [ ] The workflow is read-only in MVP.

## History

- [ ] User can see previous executions.
- [ ] User can open execution details.
- [ ] User can see per-platform results.

## Payment

- [ ] User can initiate payment.
- [ ] Backend verifies payment.
- [ ] Successful payment marks user Premium.
- [ ] Premium state persists.
- [ ] Crown badge appears after successful payment.

## Upcoming Features

- [ ] Premium user can access Upcoming Features.
- [ ] Feature cards have image, title, description, and details.
- [ ] At least the AI Content Enhancement feature is documented.
- [ ] Future features are data-driven where practical.

---

# 31. Implementation Order

Cloud Code should implement in this order.

## Step 1 — Project foundation

- Initialize frontend.
- Initialize backend.
- Configure database.
- Configure environment variables.
- Configure shared error handling.
- Configure validation.
- Configure authentication middleware.

## Step 2 — Authentication

Implement:

- Register
- Login
- Logout
- Current user
- Password recovery/reset
- Google OAuth

Verify authentication completely before continuing.

## Step 3 — User/Profile

Implement:

- Profile retrieval
- Profile update if needed
- Premium state

## Step 4 — Social integrations

Implement LinkedIn OAuth.

Test connection independently.

Then implement Facebook Page OAuth.

Test connection independently.

## Step 5 — Media upload

Implement image upload and persistent media URL/reference.

Test independently.

## Step 6 — Content

Implement:

- Create post
- Retrieve posts where necessary
- Platform selection
- Validation

## Step 7 — Publishing engine

Implement:

- Execution model
- Publishing abstraction
- LinkedIn publisher
- Facebook publisher
- Background job
- Execution state updates

## Step 8 — React Flow

Build the read-only workflow visualization.

Connect its visual state to execution state where useful.

## Step 9 — Execution history

Implement:

- Execution list
- Execution details
- Per-platform status
- Manual retry

## Step 10 — Payment

Implement the selected payment provider.

Verify payment server-side.

Update Premium status.

## Step 11 — Upcoming Features

Implement:

- Premium guard
- Feature data
- Feature list
- Feature detail

## Step 12 — End-to-end verification

Test the complete journey:

```text
Register
 ↓
Login
 ↓
Connect LinkedIn
 ↓
Connect Facebook
 ↓
Create content
 ↓
Upload image
 ↓
Select platforms
 ↓
Publish
 ↓
Leave page
 ↓
Worker executes
 ↓
Check execution history
 ↓
Verify LinkedIn
 ↓
Verify Facebook
 ↓
Simulate failure
 ↓
Retry
 ↓
Make payment
 ↓
Premium badge
 ↓
Open Upcoming Features
```

---

# 32. Development Rules for Cloud Code

These rules are mandatory.

## Rule 1 — Do not overbuild

If a feature is not required for the MVP, do not implement it.

## Rule 2 — Do not manufacture APIs

API quantity is not a goal.

Create endpoints because the application needs them.

## Rule 3 — Preserve extensibility

Where practical, isolate:

- authentication providers
- social publishers
- payment provider
- background jobs
- workflow nodes

so future implementations can be added without rewriting the core.

## Rule 4 — No fake functionality

Do not create UI buttons that pretend to work.

If something is marked MVP, it must work end-to-end.

Future features should explicitly say:

> Coming Soon

## Rule 5 — Backend is authoritative

The backend owns:

- authentication state
- premium status
- OAuth connections
- publishing execution
- execution status
- payment verification

Never rely on frontend state for authorization or payment confirmation.

## Rule 6 — Build vertically

Prefer completing one end-to-end slice before adding another.

Example:

```text
LinkedIn connect
    ↓
LinkedIn publish
    ↓
LinkedIn execution status
```

before adding unnecessary abstraction.

## Rule 7 — Keep the UI simple

The goal is a working product, not a design showcase.

---

# 33. Definition of Done

A feature is done only when:

1. Backend implementation exists.
2. Frontend implementation exists where applicable.
3. Validation exists.
4. Authorization exists.
5. Error handling exists.
6. Database state is persisted where required.
7. The feature works end-to-end.
8. It does not break existing functionality.
9. The feature has been manually tested.
10. No secrets or credentials are committed.

---

# 34. Final MVP Definition

The entire MVP can be summarized as:

```text
                    CONTENT AUTOMATION PLATFORM

User
 ↓
Register / Login / Google
 ↓
Dashboard
 ↓
Connect LinkedIn + Facebook
 ↓
Create content + image
 ↓
Select platforms
 ↓
Publish Now
 ↓
┌─────────────────────────────┐
│       BACKGROUND WORKFLOW   │
│                             │
│ START                       │
│   ↓                         │
│ PREPARE CONTENT             │
│   ↓                         │
│ LINKEDIN                    │
│   ↓                         │
│ FACEBOOK                    │
│   ↓                         │
│ END                         │
└─────────────────────────────┘
 ↓
Execution History
 ↓
Success / Partial / Failed
 ↓
Manual Retry if needed

             +

Payment
 ↓
Premium
 ↓
Crown Badge
 ↓
Upcoming Features
```

The MVP proves one fundamental hypothesis:

> **Can a user connect their social accounts, create content once, and reliably publish it to multiple platforms through a backend-controlled workflow?**

If yes, the foundation is successful.

Everything else should be treated as an extension of this foundation.

---

# 35. Future Product Principle

The product should grow by adding capabilities to the workflow rather than replacing the workflow.

Current:

```text
Content
 ↓
LinkedIn
 ↓
Facebook
```

Future:

```text
Content
 ↓
AI Improve
 ↓
User Approval
 ↓
Schedule
 ↓
Condition
 ├── LinkedIn
 ├── Facebook
 ├── Instagram
 └── YouTube
 ↓
Analytics
```

This is the long-term direction.

**Do not build the future now. Build the foundation that makes the future possible.**
