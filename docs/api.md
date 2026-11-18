# API

**Read this when** you add or change an endpoint, build a client screen, or add an AI tool.
**Related:** [architecture.md](./architecture.md#api) for the API's place in the system, [roles-and-access.md](./roles-and-access.md) for the permission rules, [workstation-and-ai.md](./workstation-and-ai.md#what-the-ai-may-do) for the AI tiers.

This is the first-release endpoint list. The generated OpenAPI spec is the exact contract. This doc is the map, and it must be updated with any endpoint change.

---

## Conventions

- **Base path.** REST and JSON under `/api/v1`. Times are in UTC (ISO 8601) and shown in Indian time by the clients.
- **Auth.** Every request carries the user's session token: a cookie on the website (later, a bearer token in the app). Calls made by the AI also carry a "via AI" mark, set by the backend.
- **The contract.** Each endpoint is defined with `defineEndpoint` in `shared/src/schemas/`, and listed in `shared/src/api/endpoints.ts`. The OpenAPI spec is generated from these definitions and served at `/api/v1/openapi.json`; outside production, `/api/v1/docs` shows it.
- **Public endpoints.** Only sign-up, sign-in and the two lists the sign-up form needs (`GET /roles`, `GET /product-lines`) work without a session. Everything else returns `NOT_SIGNED_IN` first.
- **Permission and AI tier.** Every endpoint declares both, in its schema. The OpenAPI spec shows them as `x-permission` and `x-ai-tier`:

  | Tier | What the AI may do |
  |---|---|
  | `read` | Use it freely |
  | `auto` | Use it directly, for the user's own things |
  | `confirm` | Only through a proposal the user confirms |
  | `never` | Not at all |
  | `—` | Not available as an AI tool at all (`none` in the code) |

  The tiers are explained in [workstation-and-ai.md](./workstation-and-ai.md#what-the-ai-may-do).
- **Lists** use cursor paging (`?cursor=`, `?limit=`), filters (`?filter[project]=`) and sorting. They only return what the user may see.
- **Writes.**
  - `POST` requests take an optional `Idempotency-Key` header (8 to 200 letters, digits or `-_.:`), so a retry doesn't repeat the action. The key is claimed before the action runs:
    - a repeat with the same key and request gets the first response back, marked `Idempotent-Replayed: true`;
    - a repeat that arrives while the first is still running gets `409 IDEMPOTENCY_IN_PROGRESS`;
    - the same key with a different request gets `422 IDEMPOTENCY_CONFLICT`;
    - a request that fails releases its key, so a corrected retry can use it.

    Successful responses are kept for a day.
  - Edits take an `If-Match` header with the version the user saw, so two people, or a person and the AI, can't overwrite each other. A stale version gets `412 VERSION_CONFLICT`. For `PATCH /me`, the version is the profile's `updatedAt`.
- **Preview.** Every workflow action (Go, start, submit, approve, return, decisions, send back, milestones, corrective actions, hold, resume and drop) accepts `?preview=true`. An action that can't preview refuses it with `400 VALIDATION_FAILED` instead of ignoring it, so a caller that adds `preview=true` to everything never changes anything by accident. It returns what would happen (steps opened or reset, tasks with their assignees, signatures requested, people notified, warnings) without saving anything. It is the real action run inside a transaction that is rolled back, so the preview and the result can't drift apart.
- **Errors** use the standard problem format (`application/problem+json`) with a code. The codes are listed in `shared/src/api/problem.ts`; for example `NOT_SIGNED_IN`, `NOT_ALLOWED`, `AI_NOT_ALLOWED`, `NOT_FOUND`, `VALIDATION_FAILED` (with the fields), `NAME_TAKEN`, `VERSION_CONFLICT`, `RATE_LIMITED`, `STEP_NOT_READY`, `PROJECT_NOT_ACTIVE`, `DECISION_REQUIRED`, `CORRECTIVE_ACTIONS_OPEN`, `ALREADY_DONE`, `SIGNATURE_REQUIRED` and `PREVIEW_CHANGED`. "Not allowed" names who can do it (`whoCan`); it never reveals content.

## Endpoints

### Accounts and profile

| Endpoint | Purpose | Tier |
|---|---|---|
| `POST /auth/sign-up` | Create an account: name, role, and product line for a Lead. Returns a session. **Placeholder** ([roles-and-access.md](./roles-and-access.md#accounts-for-now)) | — |
| `POST /auth/sign-in` | Sign in by name, in any case. **Placeholder** | — |
| `POST /auth/sign-out` | End the session | — |
| `GET /me` | My profile, role and product line | read |
| `PATCH /me` | Change my name, role or product line (only until there is an admin) | — |
| `GET /users`, `GET /users/{id}` | The people directory | read |
| `GET /roles` | Departments and their roles, for the sign-up form. Public | read |
| `GET /product-lines` | R&D's product lines, for the sign-up form. Public | read |

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
| `GET /processes/{key}` | A process's latest version: stages, steps, doers, signers, conditions, milestones | read |
| `GET /processes/{key}/steps/{step}` | One step's definition | read |

### Projects

| Endpoint | Purpose | Tier |
|---|---|---|
| `POST /projects` | Go: create the project from a concept, with its team and its first tasks. **Today a confirmed click by the VP**; it becomes a signed decision with passkeys. With `?preview=true`: the steps that open, the tasks and who gets them, the team and warnings, and nothing is saved | never |
| `GET /projects`, `GET /projects/{id}` | Every project's status (open to everyone signed in), with `filter[status]`, `filter[productLine]` and cursor paging. The detail also says what the signed-in person may do (`can`: hold, resume, drop, edit the team) | read |
| `GET /projects/{id}/route` | Each step's state, iteration, doers, signer, what it waits for, its decisions and tasks, and what the signed-in person may do there now (`actions`); the milestones; the open corrective actions. This is the route view | read |
| `GET /projects/{id}/team`, `PUT /projects/{id}/team` | See or change the project team (Lead or Head). The change is audited, and removed members keep their record | read / confirm |
| `POST /projects/{id}/hold`, `/resume`, `/drop` | With a reason. Who may, and when, comes from the route and the project's state | never |
| `GET /projects/{id}/activity` | The project's events, newest first, with who did them. People outside the project's scope see the status of each event only, not comments, titles or reasons | read |

*Later:* `PATCH /projects/{id}` (edit the name and description), `GET` and `PUT /projects/{id}/timeline` (with the Dashboard block).

### Steps

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /projects/{id}/steps/{key}` | The step's view, every iteration with the reason a send-back closed it, and its decisions with their reasons (the reasons only for people in the project's scope) | read |
| `POST /projects/{id}/steps/{key}/start` | A doer starts a step that is ready | confirm |
| `POST /projects/{id}/steps/{key}/submit` | Submit for sign-off, which gives the signer a task (every Board member at steps 4 and 23). For steps without a sign-off, marks the step done. `?preview=true` shows what happens | confirm |
| `POST /projects/{id}/steps/{key}/approve` | Sign off. **Today a confirmed click by the signer**, replaced by `POST /signatures` with passkeys. `?preview=true` supported | never |
| `POST /projects/{id}/steps/{key}/return` | Return to the authors with a comment (the same placeholder) | never |
| `POST /projects/{id}/steps/{key}/decisions` | Record a decision (prototypes OK, pre-clinical study needed). Only the role the route names may. Same placeholder | never |
| `POST /projects/{id}/steps/{key}/send-back` | Send work back to an earlier step the route allows, with a reason and optional evidence file. `?preview=true` lists the steps that would reset and the tasks that would be cancelled | never |
| `POST /projects/{id}/milestones` | Record a milestone, with an optional note or evidence file | confirm |
| `POST /projects/{id}/corrective-actions` | Raise a corrective action while the case study (step 16) is open. Step 18 waits until all are closed | confirm |

Every action returns `{ saved, preview }`: what changed (steps, tasks made with their assignees or queues, tasks cancelled, warnings). With `?preview=true`, `saved` is `false`. The preview runs the real code and rolls back at the end, so it can't differ from the real result.

### Tasks and requests

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /tasks` | My tasks (`scope=mine`) or the tasks waiting in my role's queue (`scope=queue`), open or closed | read |
| `GET /tasks/{id}` | One task: mine, or one waiting in my role's queue | read |
| `PATCH /tasks/{id}` | Set my own task to open, in progress or done | auto (my own) |
| `POST /tasks/{id}/claim` | Claim a task from my role's queue. I join the project team if I'm not on it. A Lead may claim only for their own product line's projects | confirm |
| `POST /tasks/{id}/reassign` | Give a task to someone who holds its role (the VP or the Head; the Lead only within the project team) | confirm |

*Later:* `POST /tasks` (own tasks, assignments and requests), `accept`, `decline` and comments.

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
| `POST /files/upload-url` | Start an upload: checks the type and size, and returns a short-lived link to upload the file to a staging area in storage. The link accepts only the declared size | auto |
| `POST /files/{id}/complete` | Finish an upload: COAL reads the staged file once, checks its size and records its SHA-256 hash, then moves exactly those bytes to where they're served from, which no upload link can write to | auto |
| `GET /files/{id}/link` | A short-lived download link, after the permission check. Until attachments exist, only the uploader may use a file | read |
| `POST /attachments`, `GET /attachments` | Attach files and pictures to a step, task or document | auto / read |
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
| Project | `project.created`, `project.held`, `project.resumed`, `project.dropped`, `project.launched`, `project.team_changed`, `project.closed` |
| Step | `step.ready`, `step.started`, `step.submitted`, `step.signed` (one of several required approvals), `step.returned`, `step.approved`, `step.done`, `step.reset`, `step.cancelled`, `decision.recorded`, `milestone.recorded` |
| Task | `task.created`, `task.assigned`, `task.updated`, `task.done`, `task.cancelled`, `task.due_soon`, `task.overdue`, `request.declined` |
| Document | `document.created`, `document.version_saved`, `document.submitted`, `document.approved`, `document.returned`, `template.added`, `template.activated` |
| Signature | `signature.requested`, `signature.signed` |
| Timeline | `deviation.required`, `deviation.recorded`, `timeline.changed`, `forecast.changed` |
| Collaboration | `comment.added`, `mention.created`, `attachment.added` |
| Proposals | `proposal.created`, `proposal.confirmed`, `proposal.rejected` |

## Adding an endpoint

1. **Define it** with `defineEndpoint` in `shared/src/schemas/<area>.ts`: the path, the request and response schemas, `auth`, the permission and the AI tier. Add it to `ENDPOINTS` in `shared/src/api/endpoints.ts`.
2. **Add the permission rule** in `backend/src/modules/permissions/rules.ts`; the type check fails until you do. Add its row to the test table in `permissions.test.ts`, which tests every role, allowed and denied ([roles-and-access.md](./roles-and-access.md#how-access-is-enforced)). Record-level rules get their own cases there.
3. **Implement it** with `implement()` in the module's `routes.ts`, and list the module's routes in `backend/src/modules/index.ts`. The backend won't start while an endpoint has no implementation.
4. **If it changes state,** run it through `change()` (`backend/src/core/db/change.ts`) so its audit entries and events are written in the same transaction, and support `?preview=true` if it's a workflow action.
5. **Update the tables in this doc.**
