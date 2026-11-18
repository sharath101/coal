# API

**Read this when** you add or change an endpoint, build a client screen, or add an AI tool.
**Related:** [architecture.md](./architecture.md#api) for the API's place in the system, [roles-and-access.md](./roles-and-access.md) for the permission rules, [workstation-and-ai.md](./workstation-and-ai.md#what-the-ai-may-do) for the AI tiers.

This is the first-release endpoint list. The generated OpenAPI spec is the exact contract. This doc is the map, and it must be updated with any endpoint change.

---

## Conventions

- **Base path.** REST and JSON under `/api/v1`. Times are in UTC (ISO 8601) and shown in Indian time by the clients.
- **Auth.** Every request carries the user's session token: a cookie on the website (later, a bearer token in the app). Calls made by the AI also carry a "via AI" mark, set by the backend.
- **The contract.** The OpenAPI spec is generated from the zod schemas in `shared/`.
- **Permission and AI tier.** Every endpoint declares both, in its schema:

  | Tier | What the AI may do |
  |---|---|
  | `read` | Use it freely |
  | `auto` | Use it directly, for the user's own things |
  | `confirm` | Only through a proposal the user confirms |
  | `never` | Not at all |
  | `—` | Not available as an AI tool at all |

  The tiers are explained in [workstation-and-ai.md](./workstation-and-ai.md#what-the-ai-may-do).
- **Lists** use cursor paging (`?cursor=`, `?limit=`), filters (`?filter[project]=`) and sorting. They only return what the user may see.
- **Writes.**
  - `POST` requests take an `Idempotency-Key` header, so a retry doesn't repeat the action.
  - Edits take an `If-Match` header with the version the user saw, so two people, or a person and the AI, can't overwrite each other.
- **Preview.** Workflow actions accept `?preview=true`. It returns what would happen (steps opened or reset, tasks with their assignees, signatures requested, people notified, warnings) without saving anything.
- **Errors** use the standard problem format (`application/problem+json`) with a code, such as `NOT_ALLOWED`, `NOT_FOUND`, `STEP_NOT_READY`, `SIGNATURE_REQUIRED`, `VERSION_CONFLICT` or `PREVIEW_CHANGED`. "Not allowed" names who can do it; it never reveals content.

## Endpoints

### Accounts and profile

| Endpoint | Purpose | Tier |
|---|---|---|
| `POST /auth/sign-up` | Create an account: name, role, and product line for a Lead. Returns a session. **Placeholder** ([roles-and-access.md](./roles-and-access.md#accounts-for-now)) | — |
| `POST /auth/sign-in` | Sign in by name. **Placeholder** | — |
| `POST /auth/sign-out` | End the session | — |
| `GET /me` | My profile, role and product line | read |
| `PATCH /me` | Change my name, role or product line (only until there is an admin) | — |
| `GET /users`, `GET /users/{id}` | The people directory | read |
| `GET /roles` | Departments and their roles, for the sign-up form | read |

### Passkeys and signing

| Endpoint | Purpose | Tier |
|---|---|---|
| `POST /passkeys/registration/options`, `POST /passkeys/registration` | Register Face ID or a fingerprint on this device | — |
| `GET /passkeys`, `DELETE /passkeys/{id}` | My devices; remove a lost one | — / never |
| `GET /signature-requests?assignee=me` | What waits for my signature | read |
| `POST /signatures/options` | Prepare a signing intent for a document version, step sign-off record, decision or Go: the hashes, the meaning, a one-time challenge | — |
| `POST /signatures` | Sign, with the passkey response | never |
| `POST /signature-requests/{id}/return` | Return to the authors with comments | never |

### Processes

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /processes` | The processes COAL runs; the R&D route is the first | read |
| `GET /processes/{key}` | A process's current version: steps, doers, signers, links | read |
| `GET /processes/{key}/steps/{step}` | One step's definition | read |

### Projects

| Endpoint | Purpose | Tier |
|---|---|---|
| `POST /projects?preview=true` | Preview Go: the steps that open, the tasks and who gets them, warnings | read |
| `POST /projects` | Go: create the project from a concept. Needs the VP's signature on the Go decision | never |
| `GET /projects`, `GET /projects/{id}` | Every project's status (open to all); content as permitted | read |
| `PATCH /projects/{id}` | Edit the name and description | confirm |
| `GET /projects/{id}/route` | Each step's state and iteration, for the route view | read |
| `GET /projects/{id}/team`, `PUT /projects/{id}/team` | See or change the project team (Lead or Head) | read / confirm |
| `GET /projects/{id}/timeline` | Baseline, current and forecast dates | read |
| `PUT /projects/{id}/timeline` (preview) | Set the baseline from the signed Action Plan, or propose new dates | confirm |
| `POST /projects/{id}/hold`, `/resume`, `/drop` | With a reason | never |
| `GET /projects/{id}/activity` | The project's activity and history | read |

### Steps

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /projects/{id}/steps/{key}` | The current iteration and earlier ones | read |
| `POST /projects/{id}/steps/{key}/submit` (preview) | Submit for sign-off; generates the step sign-off record. For steps without a sign-off, marks the step done | confirm |
| `POST /projects/{id}/steps/{key}/decisions` | Record a decision (checkpoint, prototypes OK, pre-clinical needed). Needs a signature | never |
| `POST /projects/{id}/steps/{key}/send-back` (preview) | Send work back to an earlier step. The preview shows what resets | never |
| `POST /projects/{id}/milestones` | Record a milestone, with evidence | confirm |

### Tasks and requests

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /tasks`, `GET /tasks/{id}` | My tasks, and others' tasks that I can see | read |
| `POST /tasks` (preview) | A task for myself, an assignment, or a request | auto (for myself) / confirm |
| `PATCH /tasks/{id}` | Update the status, due date or notes | auto (my own) / confirm |
| `POST /tasks/{id}/accept`, `/decline`, `/claim`, `/reassign` | Respond to a request; claim from a role queue; reassign | confirm |
| `POST /tasks/{id}/comments` | Comment, with @mentions | auto (no mentions) / confirm |

### Deviations

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /deviations` | Deviations, filtered by who may see the named cause | read |
| `POST /deviations` | Record the reason, cause and new date | confirm |
| `POST /deviations/{id}/review` | The next role up confirms or corrects it | confirm |
| `POST /deviations/{id}/comments` | The person named as the cause comments | confirm |

### Documents, templates, files and sources

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /templates`, `GET /templates/{id}` | The template library: each template's versions, status, specification and sample | read |
| `GET /templates/active?document_type=` | The active template for a document type. The AI calls this every time it drafts | read |
| `POST /templates` | Add a template, or a new version of one: the Word file and its specification. COAL checks the placeholders and makes a sample PDF | — |
| `POST /templates/{id}/versions/{n}/activate` | Make a version active; the previous one is retired (R&D Head or company QA ⚠) | never |
| `POST /documents` | A new document from the active template or an upload, as a draft I own | auto |
| `GET /documents`, `GET /documents/{id}` | List and read | read |
| `POST /documents/{id}/versions` | Save a new draft version | auto (my draft) / confirm |
| `GET /documents/{id}/versions/{n}`, `…/pdf` | A version's content and PDF | read |
| `GET /documents/{id}/compare?from=&to=` | Compare two versions | read |
| `POST /documents/{id}/submit` (preview) | Start the signature rows | confirm |
| `POST /files/upload-url`, `POST /attachments`, `GET /attachments` | Upload files and pictures; attach them to a step, task or document | auto / read |
| `POST /sources`, `GET /sources` | Add or list sources | auto / read |
| `GET /history/{recordType}/{id}` | A record's history | read |

### Dashboard and notifications

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /widgets` | The widgets I can use and my layout | read |
| `GET /widgets/{key}?view=compact\|expanded&tab=&filter[...]=` | One widget's data | read |
| `GET /notifications`, `POST /notifications/{id}/read` | My notifications | read / auto |
| `GET /stream` | Server-Sent Events: live widget refreshes and notifications | — |
| `GET /search?q=` | Projects, documents, tasks and people, filtered by permission | read |

### AI

| Endpoint | Purpose | Tier |
|---|---|---|
| `POST /ai/chats`, `GET /ai/chats`, `GET /ai/chats/{id}` | Start a chat (optionally with a project, step, document, task or widget as context); list and read my chats | — |
| `POST /ai/chats/{id}/messages` | Send a message. The reply streams back | — |
| `POST /ai/chats/{id}/stop` | Stop the current reply | — |
| `POST /ai/feedback` | Thumbs up or down on a reply | — |

## Proposals and action cards

A proposal is a set of actions with their preview, waiting for the user to confirm it. Action cards in the Workstation are proposals. The website also uses them for bulk actions.

| Endpoint | Purpose | Tier |
|---|---|---|
| `POST /proposals` | Create a proposal from one or more actions. The server previews them and stores the result as version 1 | auto |
| `GET /proposals?status=pending`, `GET /proposals/{id}` | My pending proposals | read |
| `PATCH /proposals/{id}` | Edit (assignee, dates, wording). Previews again and creates a new version | auto |
| `POST /proposals/{id}/confirm` | Carry it out. Needs `If-Match` with the version the user saw | never |
| `POST /proposals/{id}/reject` | Discard it | never |

**Rules**

- **Who can confirm.** Only the user the proposal is for can confirm it, and never through a "via AI" call.
- **Re-check on confirm.** Confirming checks permissions again and previews again. If who or what would be affected has changed, it returns `PREVIEW_CHANGED` with the new preview, and nothing happens.
- **All or nothing.** All the actions in a proposal run in one transaction, at most once. The audit trail records the user and the chat that prepared it.
- **Expiry.** Proposals expire if not confirmed (a setting).

## Events

Events are written in the same transaction as the change ([architecture.md](./architecture.md#events-and-live-updates)). Each carries the project, the step if any, the actor (user, user via AI, or system), the time and a payload.

| Group | Events |
|---|---|
| Project | `project.created`, `project.held`, `project.resumed`, `project.dropped`, `project.launched` |
| Step | `step.ready`, `step.started`, `step.submitted`, `step.returned`, `step.approved`, `step.done`, `step.reset`, `decision.recorded`, `milestone.recorded` |
| Task | `task.created`, `task.assigned`, `task.updated`, `task.done`, `task.due_soon`, `task.overdue`, `request.declined` |
| Document | `document.created`, `document.version_saved`, `document.submitted`, `document.approved`, `document.returned`, `template.added`, `template.activated` |
| Signature | `signature.requested`, `signature.signed` |
| Timeline | `deviation.required`, `deviation.recorded`, `timeline.changed`, `forecast.changed` |
| Collaboration | `comment.added`, `mention.created`, `attachment.added` |
| Proposals | `proposal.created`, `proposal.confirmed`, `proposal.rejected` |

## Adding an endpoint

1. Define the request and response schemas in `shared/src/schemas/`.
2. Declare the permission and the AI tier.
3. Add the permission rule, and allowed and denied tests for each role ([roles-and-access.md](./roles-and-access.md#how-access-is-enforced)).
4. If it changes state, write audit entries and events in the same transaction, and support `?preview=true` if it's a workflow action.
5. Update the tables in this doc.
