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
- **Lists** use cursor paging (`?cursor=`, `?limit=`), filters (`?filter[project]=`) and sorting. They only return what the user may see. A cursor holds a time cut to milliseconds, and lists order by the same cut time, so rows made in one transaction are never skipped between pages (P67).
- **Writes.**
  - `POST` requests take an optional `Idempotency-Key` header (8 to 200 letters, digits or `-_.:`), so a retry doesn't repeat the action. The key is claimed before the action runs:
    - a repeat with the same key and request gets the first response back, marked `Idempotent-Replayed: true`;
    - a repeat that arrives while the first is still running gets `409 IDEMPOTENCY_IN_PROGRESS`;
    - the same key with a different request gets `422 IDEMPOTENCY_CONFLICT`;
    - a request that fails releases its key, so a corrected retry can use it.

    Successful responses are kept for a day.
  - Edits take an `If-Match` header with the version the user saw, so two people, or a person and the AI, can't overwrite each other. A stale version gets `412 VERSION_CONFLICT`. For `PATCH /me`, the version is the profile's `updatedAt`.
- **Preview.** Every workflow action (Go, start, submit, approve, return, decisions, send back, milestones, corrective actions, hold, resume and drop) accepts `?preview=true`. An action that can't preview refuses it with `400 VALIDATION_FAILED` instead of ignoring it, so a caller that adds `preview=true` to everything never changes anything by accident. It returns what would happen (steps opened or reset, tasks with their assignees, signatures requested, people notified, warnings) without saving anything. It is the real action run inside a transaction that is rolled back, so the preview and the result can't drift apart.
- **Errors** use the standard problem format (`application/problem+json`) with a code. The codes are listed in `shared/src/api/problem.ts`; for example `NOT_SIGNED_IN`, `NOT_ALLOWED`, `AI_NOT_ALLOWED`, `NOT_FOUND`, `VALIDATION_FAILED` (with the fields), `NAME_TAKEN`, `VERSION_CONFLICT`, `RATE_LIMITED`, `STEP_NOT_READY`, `PROJECT_NOT_ACTIVE`, `DECISION_REQUIRED`, `CORRECTIVE_ACTIONS_OPEN`, `ALREADY_DONE`, `SIGNATURE_REQUIRED`, `PREVIEW_CHANGED`, `PROPOSAL_EXPIRED`, `AI_UNAVAILABLE`, `AI_BUDGET_REACHED`, `CHAT_BUSY`, `NO_TEMPLATE`, `DOCUMENT_LOCKED` (a version with the signers, an approved one, or a step that isn't open), `SEPARATION_OF_DUTIES` (the author can't also approve), `PDF_UNAVAILABLE` (the PDF service is down) and `FILE_NOT_SCANNED`, `DEVIATION_REQUIRED` (a late step can't be submitted, and a late task can't be closed, until a deviation says why) and `DOCUMENTS_NEEDED` (a step can't be submitted until its documents are made or uploaded and filled in; `errors` lists what is missing). "Not allowed" names who can do it (`whoCan`); it never reveals content.

## Endpoints

### Accounts and profile

| Endpoint | Purpose | Tier |
|---|---|---|
| `POST /auth/sign-up` | Create an account: name and a position (a product line for a position counted by line). A position with no seat left is refused with `409 POSITION_FULL`. Returns a session. **Placeholder** ([roles-and-access.md](./roles-and-access.md#accounts-for-now)) | — |
| `POST /auth/sign-in` | Sign in by name, in any case. **Placeholder** | — |
| `POST /auth/switch` | **Demo only, temporary** ([P113](./decisions.md)): the admin takes another person's place, or goes back to the admin. Ends the session and starts one for that person. Only from a session an admin started, and only while `ADMIN_SWITCHING` is on; audited as `session.switched`. Never the AI's | — |
| `POST /auth/sign-out` | End the session | — |
| `GET /me` | My profile, position, role and product line, who I report to (`reportsTo`), `features` (what is switched on: `templateFilling`, which is parked and off by default: [P109](./decisions.md)) and `switcher` (the admin behind the session, when there is one) | read |
| `PATCH /me` | Change my name, position or product line (a full position is refused with `409 POSITION_FULL`; only until there is real sign-in) | — |
| `GET /users`, `GET /users/{id}` | The people directory. It leaves out the demo admin | read |
| `GET /org-chart` | Every position on Jayon's chart, who reports to whom, and who holds each ([roles-and-access.md](./roles-and-access.md#the-org-chart)) | read |
| `GET /roles` | Departments, roles and the positions people may choose, with whether each still has a seat (no names), for the sign-up form. Public | read |
| `GET /product-lines` | R&D's product lines, for the sign-up form. Public | read |

### Signing

Signing is a confirmed click until passkeys arrive in the last block ([D16](./decisions.md)). The passkey endpoints below are planned for then; the rest exist now.

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /signature-requests` | What waits for my signature: the rows I may sign now, on documents (a step sign-off record is signed by approving its step) | read |
| `POST /signature-requests/{id}/sign` | Sign a row. A confirmed click: the signature is tied to the version's content and PDF hashes. `?preview=true` supported | never |
| `POST /signature-requests/{id}/return` | Return the document to its authors with a comment, instead of signing | never |
| `POST /documents/{id}/versions/{n}/submit` | Submit a draft: the author signs Prepared and the next row opens. `?preview=true` supported | confirm |
| `POST /passkeys/registration/options`, `POST /passkeys/registration` | *Planned (last block).* Register Face ID or a fingerprint on this device | — |
| `GET /passkeys`, `DELETE /passkeys/{id}` | *Planned.* My devices; remove a lost one | — / never |
| `POST /signatures/options`, `POST /signatures` | *Planned.* Prepare a signing intent, then sign with the passkey response. These replace `…/sign`, and the step approve and decision clicks | — / never |

### Processes

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /processes` | The processes COAL runs; the R&D route is the first | read |
| `GET /processes/{key}` | A process's latest version: stages, steps, doers, signers, conditions, milestones | read |
| `GET /processes/{key}/steps/{step}` | One step's definition | read |

### Projects

| Endpoint | Purpose | Tier |
|---|---|---|
| `POST /projects` | Go: create the project from a concept, with its team and its first tasks. **A confirmed click by the VP, recorded as a signed decision** (passkeys come in the last block). With `?preview=true`: the steps that open, the tasks and who gets them, the team and warnings, and nothing is saved | never |
| `POST /projects/preview` | What Go would do for a concept (name, description, product line, team), changing nothing: the steps that open and who gets each task. Only those who may press Go. The assistant uses it for an idea | read |
| `GET /projects`, `GET /projects/{id}` | Every project's status (open to everyone signed in), with `filter[status]`, `filter[productLine]` and cursor paging. The detail also says what the signed-in person may do (`can`: hold, resume, drop, edit the team) | read |
| `GET /projects/{id}/route` | Each step's state, iteration, doers, signer, what it waits for, what submitting still needs (`submitNeeds`, and `documentNeeds` for documents not yet made, uploaded or filled in), its decisions and tasks, who a handed-in step waits on (`withSigners`: the signers who have not signed yet, since when, their date, how many working days late they are, and the last reminder), and what the signed-in person may do there now (`actions`); the milestones; the open corrective actions. This is the route view | read |
| `GET /projects/{id}/team`, `PUT /projects/{id}/team` | See or change the project team (Lead or Head). The change is audited, and removed members keep their record | read / confirm |
| `POST /projects/{id}/hold`, `/resume`, `/drop` | With a reason. Who may, and when, comes from the route and the project's state | never |
| `GET /projects/{id}/activity` | The project's events, newest first, with who did them. People outside the project's scope see the status of each event only, not comments, titles or reasons | read |

*Later:* `PATCH /projects/{id}` (edit the name and description), `GET` and `PUT /projects/{id}/timeline` (with the Dashboard block).

### Steps

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /projects/{id}/steps/{key}` | The step's view, every iteration with the reason a send-back closed it, and its decisions with their reasons (the reasons only for people in the project's scope) | read |
| `POST /projects/{id}/steps/{key}/start` | A doer starts a step that is ready | confirm |
| `POST /projects/{id}/steps/{key}/submit` | Submit for sign-off, which gives the signer a task (every Board member at steps 4 and 23). For steps without a sign-off, marks the step done. Refused with `409 DOCUMENTS_NEEDED` until the step's documents are made or uploaded and filled in ([P106](./decisions.md)). `?preview=true` shows what happens; the website always previews and asks first | confirm |
| `POST /projects/{id}/steps/{key}/remind` | Remind the signers who have not signed a handed-in step yet: each gets a notification naming who sent it (everyone holding the role, for a sign-off still in a queue). The step's doers only, once a day: `409 ALREADY_REMINDED` for a second, `409 NOT_WITH_SIGNERS` when the step is not with its signers. Recorded in the audit trail and the project's activity | confirm |
| `POST /projects/{id}/steps/{key}/approve` | Sign off. **A confirmed click by the signer**: it signs the step's sign-off record and records the checkpoint decision, signed. Passkeys replace the click in the last block (`POST /signatures`). `?preview=true` supported | never |
| `POST /projects/{id}/steps/{key}/return` | Return to the authors with a comment (the same placeholder) | never |
| `POST /projects/{id}/steps/{key}/decisions` | Record a decision (prototypes OK, pre-clinical study needed). Only the role the route names may. Same placeholder | never |
| `POST /projects/{id}/steps/{key}/send-back` | Send work back to an earlier step the route allows, with a reason and optional evidence file. `?preview=true` lists the steps that would reset and the tasks that would be cancelled | never |
| `POST /projects/{id}/milestones` | Record a milestone, with an optional note or evidence file | confirm |
| `POST /projects/{id}/corrective-actions` | Raise a corrective action while the case study (step 16) is open. Step 18 waits until all are closed | confirm |

Every action returns `{ saved, preview }`: what changed (steps, tasks made with their assignees or queues, tasks cancelled, warnings). With `?preview=true`, `saved` is `false`. The preview runs the real code and rolls back at the end, so it can't differ from the real result.

### Tasks and requests

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /tasks` | My tasks (`scope=mine`), the tasks waiting in my role's queue (`scope=queue`), or the work and requests I gave others (`scope=sent`), open or closed. A doer's task that is `waiting` carries `waitingOn`, the same as the step's `withSigners` | read |
| `GET /tasks/{id}` | One task: mine, one waiting in my role's queue, or one I gave | read |
| `PATCH /tasks/{id}` | Set my own task, assignment, request or corrective action to open, in progress or done. Starting or finishing a request accepts it. A task of a step follows its step and is refused with `409 USE_THE_STEP`: start the step and submit it instead. A task has `followsStep` to say which it is | auto (my own) |
| `POST /tasks/{id}/claim` | Claim a task from my role's queue. I join the project team if I'm not on it. A Lead may claim only for their own product line's projects | confirm |
| `POST /tasks/{id}/reassign` | Give a task to someone who holds its role (the VP or the Head; the Lead only within the project team) | confirm |
| `POST /tasks` | Make a task: for myself (`own`), assigned to someone I may direct (`work`), or a `request` to anyone else, decided by [the org chart](./roles-and-access.md#assigning-work-and-making-requests). Optionally on a project and step I work on, with a due date. `?preview=true` says which it would be | auto (my own); the AI proposes the rest |
| `POST /tasks/{id}/accept` | Accept a request made of me: it becomes my task, and the person who asked is told | confirm |
| `POST /tasks/{id}/decline` | Decline a request made of me, with a reason the person who asked sees on the task | confirm |

Work given by hand (`POST /tasks`) isn't on the route's plan: no step closes or resets it, and a late one can be closed without a deviation ⚠ ([W25](./open-questions.md#workflow)).

*Later:* comments on tasks.

### Deviations

*Moved: deviations are under [Dates, deviations and the plan](#dates-deviations-and-the-plan), below.*

### Documents, templates, files and sources

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /document-types` | Each kind of document, with its active template if it has one | read |
| `GET /templates`, `GET /templates/{id}` | The template library: each version's status, specification (null for a plain Word form) and who added and approved it. Everyone sees the active versions; the VP and the R&D Head also see drafts and retired ones | read |
| `GET /templates/active?documentType=` | The approved template for a document type. The AI calls this every time it makes a document | read |
| `GET /templates/{id}/links` | Short-lived links to a template's PDF, to its **blank Word form** (`form`, for everyone once it is the approved version; drafts and retired versions only for the VP and the Head) and to the Word file as it was uploaded (`docx`, the VP and the Head) | read |
| `POST /document-types` | Add a kind of document made from a template: code, name, the steps it belongs to, numbering (left out: `{project_code}-{type}-{nn}`) and who signs (VP or R&D Head). A failure lists every problem. It goes on an action card with the first template of the type | confirm |
| `GET /templates/sample-outline?fileId=` | A sample the person uploaded (a Word file, or a PDF with text) as a numbered outline: every paragraph, table cell, header and footer, with its place. A PDF is read as a plain Word form (`layout: rebuilt`). Refuses a scan, a PDF over 30 pages or 10 MB, a file that is not theirs, and anyone but the VP and the R&D Head. Its text is outside text | read |
| `POST /templates/prepare` | Turn a sample into a template without saving one: COAL puts the placeholders into the Word file as the plan says (or builds a plain Word form from a PDF), checks it like an upload and makes a sample PDF; both are stored as the person's files, each pointing at the one it was made from. A failure is `400 VALIDATION_FAILED` with every problem | read |
| `POST /templates` | Add a template version (VP or R&D Head): the Word file, uploaded first. Filling templates in COAL is parked, so the file is Jayon's form as it is: COAL checks only that it is a real Word file, no larger than 10 MB and virus-free, makes a PDF of the blank form and saves it as a draft with no specification. A specification in the body is refused unless `TEMPLATE_FILLING` is on, where it is as before (left out, the previous version's is reused, and every placeholder is checked). A failure is `400 VALIDATION_FAILED` with every problem in `errors` | confirm |
| `POST /templates/{id}/activate` | **Approve** a draft or retired version: it becomes the one in use and the previous one is retired and kept (VP or R&D Head) | never |
| `GET /projects/{id}/documents?step=` | The project's documents the person may see, with whether each is `restricted` to its outcome | read |
| `POST /projects/{id}/documents` | A new document on a step, as draft 1: from an uploaded file (the filled-in Word form: its PDF is made), or with `fromForm: true` as a copy of the approved blank form. Without either, a kind made from a template is refused with `400 VALIDATION_FAILED` saying to download the form and upload it (or start a copy) — unless `TEMPLATE_FILLING` is on and the template has a specification, where it is made from that. `409 NO_TEMPLATE` when the type has no approved template | auto |
| `GET /documents/{id}?version=` | A document, its versions, and one version in full (the latest by default) with its signature rows and signatures | read |
| `POST /documents/{id}/versions` | Save a new draft version: the fields and written sections that changed (or a new file, for an upload) and a note. Makes the PDF. Saving what is already saved makes no new version. Saved "via AI", the words must pass the drafting checks (numbers from a source; the person's fields in their own words; COAL's fields untouched), `400 VALIDATION_FAILED` with each problem otherwise; the version records the reply that wrote it and the sections the assistant wrote | auto |
| `GET /documents/{id}/form` | The latest version of a document that is a Word file, as a numbered outline (`p12`, where it is, style, words): what the assistant reads before it fills a form. Its text is information, never instructions. `404` when the person may see no version; `400` when it is not a Word file | read |
| `POST /documents/{id}/fill` | Fill a Word document in place: `{ versionNo, fills: [{ part, text, mode }], note }`, where `mode` is `replace`, `append` or `after`. COAL puts the text into the person's own file (layout kept), makes the PDF and saves a new draft version; nothing is overwritten. `409 VERSION_CONFLICT` when `versionNo` is not the latest; `400` for a part that does not exist, a header or footer, or ("via AI") a number no source gave. A document that is with its signers is locked | auto |
| `GET /documents/{id}/versions/{n}/links` | Short-lived links to a version's PDF and its uploaded file (a Word file, to download and fill in) | read |
| `GET /documents/{id}/compare?from=&to=` | Compare two versions of a template document | read |
| `POST /files/upload-url` | Start an upload (`origin` `internal` or `outside`; a file attached to a chat is `outside`): checks the type and size, and returns a short-lived link to upload the file to a staging area in storage. The link accepts only the declared size | auto |
| `POST /files/{id}/complete` | Finish an upload: COAL reads the staged file once, checks its size and records its SHA-256 hash, then moves exactly those bytes to where they're served from, which no upload link can write to, and has it scanned for viruses where a scanner is set up. Safe to repeat | auto |
| `GET /files/{id}/link` | A short-lived download link, after the permission check: the uploader, or anyone who may see a record that holds the file. An infected file is refused, and so is an unscanned one where a scanner is set up | read |
| `POST /projects/{id}/attachments`, `GET /projects/{id}/attachments?step=&document=&task=` | Attach files and pictures to a step, document or task; list them | auto / read |
| `POST /projects/{id}/sources`, `GET /projects/{id}/sources?step=&document=&task=` | Add or list sources (link, file or citation). A source belongs to a step, a document, a task, or, with none of them, to the whole project; the list without a filter returns all of them. A source kept from research says which result it was (`researchResultId`) | auto / read |
| `GET /history/{recordType}/{id}` | A record's history | read |

### Dates, deviations and the plan

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /projects/{id}/timeline` | Planned and forecast dates and health for every step, the baseline and its changes, the plan being written, and what I may do | read |
| `PUT /projects/{id}/timeline/plan` | Write each role's dates for the remaining steps, while the Action Plan step is open (its doers). The VP's sign-off makes them the baseline | confirm |
| `POST /projects/{id}/timeline/changes` | Change a planned date after the baseline, with a reason (the Head; only the VP for the launch step). The baseline is kept | confirm |
| `GET /deviations` | Deviations (`filter[project]`, `filter[state]=review`). The named cause shows only to those allowed; the sentence of explanation and the comments only to people in the project's scope | read |
| `POST /deviations` | Record why a task is late or will be: the reason, the cause and the new expected date (the task's assignee, the Lead of the line or the Head) | confirm |
| `POST /deviations/{id}/review` | The next role up, or anyone above in the project's scope, confirms it or corrects it (a new deviation that points at the old one) | confirm |
| `POST /deviations/{id}/comments` | The person, or role, named as the cause comments | confirm |

### Dashboard and notifications

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /widgets` | The widgets I can use, with their tabs, filters and columns, and my layout (the keys in order) | read |
| `GET /widgets/{key}?view=compact\|expanded&tab=&filter[...]=` | One widget's data: counts, and rows with a title, a subtitle, badges, the table's cells, actions and references. Counts only what I may see | read |
| `GET /notifications`, `POST /notifications/{id}/read`, `POST /notifications/read-all` | My notifications and work messages, and the unread count | read / auto |
| `GET /stream` | Server-Sent Events. Hints only, never content: `{"type":"widgets","keys":[…]}` (fetch these widgets again) and `{"type":"notification"}`. Needs a session. *Not in the endpoint list or the OpenAPI file, because it isn't a request and response* | — |
| `GET /search?q=&types=` | Projects, documents, tasks and people matching some words (PostgreSQL full-text search with English stemming, plus parts of codes and names). Each kind is filtered by its own rule: every project (status is open), documents the person may open in full (drafts only for the people who work on the project), their own tasks, queue and given work, and the people directory | read |

### AI

None of these is available to the AI as a tool (`—`): they are how a person talks to it. A chat belongs to the person who started it, whatever their role.

| Endpoint | Purpose | Tier |
|---|---|---|
| `POST /ai/chats` | Start a chat, optionally pinned to a project, a step of it, a document, a task or a widget. What it is pinned to must exist and be something the person may open | — |
| `GET /ai/chats?filter[project]=` | My chats, most recently used first, or those about one project | — |
| `GET /ai/chats/{id}` | One of my chats with its messages (the latest 200), my ratings, and its action cards as they stand now | — |
| `POST /ai/chats/{id}/messages` | Send a message (`text`, and up to three `fileIds`: the person's own finished Word or PDF uploads) and get the reply. Plain: the finished reply as JSON (`userMessage` and `message`). With `Accept: text/event-stream`: the reply streams as events ([below](#streaming-a-reply)). `409 CHAT_BUSY` while a reply is being written; `429 AI_BUDGET_REACHED` once today's budget is used; `503 AI_UNAVAILABLE` where no provider is set up; `502 AI_UNAVAILABLE` when the model can't be reached. Refusals come back as a normal problem response, before any stream starts | — |
| `POST /ai/chats/{id}/stop` | Stop the reply being written. What was written is kept and marked `stopped`. `{ "stopped": false }` when none is running. It reaches the API copy that is writing it ⚠ | — |
| `POST /ai/feedback` | Thumbs up or down, with an optional comment, on a reply of mine. Sending again changes the rating | — |

A **message** has `parts` that every channel shows in its own way: `text` (with its `citations`, the records it rests on), `activity` (what the AI looked at, one line each) and `file` (a file the person attached), `draft` (a version of a document the assistant saved: the document, the version and what is still missing), `idea` (a new project worked out from an idea, with who would get what, to review and Go) and `card` (an action card, by proposal id; the card itself is in the chat's `proposals`).

#### Streaming a reply

The events, in order, each as `event: <type>` and `data: <json>` (the shapes are `ChatStreamEvent` in `shared/src/schemas/ai.ts`):

| Event | Meaning |
|---|---|
| `start` | The person's message is saved |
| `text` | Some more of the reply (`delta`). Words that follow a lookup start a new paragraph |
| `activity` | A lookup started, finished or failed (`id`, `tool`, `label`, `state`) |
| `card` | An action card was prepared or changed (`proposalId`) |
| `draft` | The assistant saved a draft of a document (`documentId`, `versionNo`, `title`, `projectId`, `gaps`) |
| `idea` | The assistant worked out a project from an idea (`name`, `description`, `productLineId`, `teamUserIds`, `preview`) |
| `done` | The reply is saved (`message`, with citations resolved: tags the AI made up are gone) |
| `title` | A short title for a new chat |
| `error` | The reply failed (`code`, `detail`). A reply that was cut short is still saved |

Closing the connection stops the reply.

### Research

Research in public sources ([workstation-and-ai.md](./workstation-and-ai.md#researching-what-already-exists)). A run belongs to the person who ran it, whatever their role: its results are outside material until they keep them.

| Endpoint | Purpose | Tier |
|---|---|---|
| `GET /research-sources` | The source library: each place, its kind and settings, the note on when to use it, whether it is switched on, and whether COAL can search it here (`searchable`) or the person opens it | read |
| `POST /research-sources`, `PATCH /research-sources/{id}` | Add a place, or change one or switch it off (VP, R&D Head, R&D Leads ⚠). Its `settings` say how to search it, by kind: `pubmed`, `europepmc`, `clinicaltrials`, `openfda` (`datasets`), `journal` (`issn`, optional `pubmedTitle`), `website` (`domains`) or `link` (an https `url`, `{q}` for the words). Names are unique, ignoring case | never |
| `POST /research` | Start a run: `question` (stays in COAL), `terms` (up to 8, at most 6 words each: the only words that leave COAL), `sourceIds`, optional `since` (a year), `projectId` and `stepKey`. `400 VALIDATION_FAILED` for terms that name a project, a person or the company, or sources not switched on; `503 AI_UNAVAILABLE` or `429 AI_BUDGET_REACHED` when something would be searched. The run is `queued` and a job runs it; with only link sources it is `done` at once. Its card shows the terms and where they go | confirm |
| `GET /research?proposal=`, `GET /research/{id}` | My runs, newest first (or the one a card started); one run with its brief (citing `[R1]`), its results (each with its source, kind, the source's own id, the address COAL built, a few lines, and when it was kept), the searches that were sent, and the places to open with the search ready | never |
| `POST /research/{id}/stop` | Stop it: a queued run at once, a running one at its next search. What was found is kept | never |
| `POST /research/{id}/keep` | Keep results as sources of a project (`projectId`, `results` with an optional `note` each, and optionally a `stepKey` to put them on one step). Without a step they belong to the whole project, for everyone working on it. Under the rule for adding a source there. Only kept results are records the assistant can read | never |

## Proposals and action cards

A proposal is a set of actions with their preview, waiting for the user to confirm it. Action cards in the Workstation are proposals. The website also uses them for bulk actions.

| Endpoint | Purpose | Tier |
|---|---|---|
| `POST /proposals` | Create a proposal from one or more actions. The server previews them and stores the result as version 1 | auto |
| `GET /proposals?status=`, `GET /proposals/{id}` | My proposals (pending, confirmed, rejected, expired) | read |
| `PATCH /proposals/{id}` | Edit (assignee, dates, wording). Previews again and creates a new version. `If-Match` with the version seen is checked when sent | auto |
| `POST /proposals/{id}/confirm` | Carry it out. Needs `If-Match` with the version the user saw | never |
| `POST /proposals/{id}/reject` | Discard it | never |

**Actions.** An action is a call to an endpoint, as `{ endpoint, params, query, body, ifMatch }`, such as `{ "endpoint": "tasks.create", "body": { "title": "Rerun the FEA", "assigneeId": "…" } }`. It runs through the endpoint's own checks and handler, as the user, so a card can do exactly what the user could do on a screen. Only endpoints of the `auto` or `confirm` tier whose implementation says how to describe itself can be proposed (`describe` in `implement()`; the backend refuses to start otherwise). Now: `tasks.create`, `tasks.accept`, `tasks.decline`, `tasks.claim`, `tasks.reassign`, `steps.start`, `steps.submit`, `deviations.record`, `templates.create`, `documentTypes.create` and `research.start`. More are added as the AI needs them.

**The preview** of each action has a summary in plain words ("Assign to Dev Example: Rerun the FEA, due 27 Nov"), its effects (steps that move, tasks made with their assignees or queues, warnings) and who is told.

**Rules**

- **Who can confirm.** Only the user the proposal is for can confirm it, and never through a "via AI" call.
- **How the preview is made.** The server runs every action, in order, inside one transaction and rolls it back, so a later action sees what an earlier one would do. Nothing is stored or rendered during a preview: no file is written and no PDF is made.
- **Re-check on confirm.** Confirming runs the actions again for real, in one transaction, and compares what they did with the preview the user saw. If anything differs (for example, the assignee left the team, so an assignment would now be a request), it is all undone, the new preview is saved as the next version, and the answer is `409 PREVIEW_CHANGED`. The user looks again and confirms the new version.
- **All or nothing.** All the actions in a proposal run in one transaction, at most once. If any is refused, nothing happens, the refusal names the action ("Action 2: …"), and the card stays pending so it can be edited or discarded.
- **Recorded.** The audit trail records each action as the user's, and a `proposal.confirmed` entry with the chat that prepared it, in the same transaction. A task made from a card the AI prepared shows that it came through the Workstation.
- **Expiry.** A proposal expires if it isn't confirmed within `PROPOSAL_EXPIRY_HOURS` (72 hours ⚠, [AI9](./open-questions.md#ai)): `409 PROPOSAL_EXPIRED`.

## Events

Events are written in the same transaction as the change ([architecture.md](./architecture.md#events-and-live-updates)). Each carries the project, the step if any, the actor (user, user via AI, or system), the time and a payload.

| Group | Events |
|---|---|
| Project | `project.created`, `project.held`, `project.resumed`, `project.dropped`, `project.launched`, `project.team_changed`, `project.closed` |
| Step | `step.ready`, `step.started`, `step.submitted`, `step.signed` (one of several required approvals), `step.returned`, `step.approved`, `step.done`, `step.reset`, `step.cancelled`, `decision.recorded`, `milestone.recorded` |
| Task | `task.created`, `task.assigned`, `task.updated`, `task.done`, `task.cancelled`, `task.accepted`, `task.declined`. Events about work given by hand carry no project, so the project's activity feed (which shows status to everyone) never shows their words |
| Document | `document.created`, `document.version_saved`, `document.submitted`, `document.approved`, `document.returned`, `document.carried_forward`, `template.added`, `template.activated` |
| Signature | `signature.requested` (a row has opened), `signature.signed` |
| Timeline | `timeline.changed` (a baseline or a date change), `forecast.changed`, `project.health_changed`, `deviation.recorded`, `deviation.reviewed` |
| Collaboration | `comment.added`, `mention.created`, `attachment.added`, `source.added` |
| Proposals | `proposal.created`, `proposal.confirmed`, `proposal.rejected` |
| Research | `research.requested` (a confirmed run is handed to the job queue) |

## Adding an endpoint

1. **Define it** with `defineEndpoint` in `shared/src/schemas/<area>.ts`: the path, the request and response schemas, `auth`, the permission and the AI tier. Add it to `ENDPOINTS` in `shared/src/api/endpoints.ts`.
2. **Add the permission rule** in `backend/src/modules/permissions/rules.ts`; the type check fails until you do. Add its row to the test table in `permissions.test.ts`, which tests every role, allowed and denied ([roles-and-access.md](./roles-and-access.md#how-access-is-enforced)). Record-level rules get their own cases there.
3. **Implement it** with `implement()` in the module's `routes.ts`, and list the module's routes in `backend/src/modules/index.ts`. The backend won't start while an endpoint has no implementation.
4. **If it changes state,** run it through `change()` (`backend/src/core/db/change.ts`) so its audit entries and events are written in the same transaction, and support `?preview=true` if it's a workflow action.
5. **If the AI may propose it** (an `auto` or `confirm` endpoint), give its `implement()` a `describe` that puts its result in plain words for the action card, and add a test that confirms a card with it.
6. **Update the tables in this doc.**
