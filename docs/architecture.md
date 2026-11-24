# Architecture

**Read this when** you set up the code, add a module or a department, work on the process engine, events, the AI module, files, sign-in or hosting.
**Related:** [api.md](./api.md) for the endpoints, [data-model.md](./data-model.md) for the tables, [decisions.md](./decisions.md) for why things were chosen.

---

## The parts

COAL is four parts in one repository. The backend is separate, so every client uses the same API: the website now, and later the WhatsApp chat and the mobile app.

```mermaid
flowchart TB
  WEB["web: website (Next.js)"]
  BOT["Later: WhatsApp chat"]
  APP["Later: mobile app (Expo)"]
  subgraph BACKEND["backend"]
    API["REST API: every request is permission-checked"]
    ENG["Process engine (from shared)"]
    AIM["AI module: gateway, tools and channels"]
    WRK["Workers: jobs, reminders, PDFs, notifications"]
  end
  PG[("PostgreSQL")]
  S3[("File storage (S3)")]
  GOT["Gotenberg: Word to PDF"]
  LLM["AI provider: Anthropic (Claude)"]

  WEB --> API
  BOT -.-> API
  APP -.-> API
  API --> ENG
  API --> AIM
  AIM --> LLM
  API --> PG
  WRK --> PG
  API --> S3
  WRK --> GOT
```

| Part | Folder | What it does |
|---|---|---|
| Backend | `backend/` | The REST API, the process engine's database side, the AI module, background workers, document generation and the audit trail. **All rules live here.** |
| Website | `web/` | The Dashboard and Workstation in the browser. |
| Mobile app | `app/` | **A later phase** (web first). The same features as the website, on iOS and Android, with push notifications and Face ID or fingerprint signing. |
| Shared code | `shared/` | Used by the backend and the website, and later the app: API schemas and types, route definitions and the pure engine, widget definitions, and shared rules. |

**Import rules**

- `web/` and `app/` import only from `shared/`, and talk to `backend/` only through the API.
- `backend/` imports from `shared/`.
- `shared/` imports from none of them.
- Anything two parts need goes in `shared/`.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere; pnpm workspaces | One language, and shared types between the API and the clients |
| Backend | Node.js with Fastify | Light and fast, with good support for schemas and OpenAPI |
| Schemas | zod in `shared/`; the OpenAPI spec is generated from them | One definition gives validation, types for the clients, and the API document |
| Database | PostgreSQL, with Drizzle for queries and migrations | Relational data, JSON fields for document content, full-text search, and the job queue in one place |
| Jobs | pg-boss, a job queue inside PostgreSQL | No extra server to run |
| Website | Next.js (React), Tailwind, shadcn/ui, TanStack Query; next-intl for the text | Widely known; quick to build dashboards and chat; every piece of text ready for translation |
| Mobile app | Later: React Native with Expo; TanStack Query | Shares TypeScript and logic with the website; one codebase for iOS and Android |
| AI | Vercel AI SDK with the Anthropic provider (D17); the GitHub Copilot SDK as a temporary stand-in on one laptop (D19) | Tool calling and streaming behind one interface, so the provider can change |
| Passkeys | The last block (D16): SimpleWebAuthn on the backend and website; later, a React Native passkey library in the app | Standard WebAuthn passkeys |
| Documents | docxtemplater (fills Word templates) and Gotenberg (Word to PDF) | Keeps Jayon's own layouts |
| Files | S3-compatible storage (MinIO for local development); ClamAV for virus scanning (optional locally, required in production) | Cheap and durable, and uploads are checked before anyone opens them |
| Live updates | Server-Sent Events | Simple one-way updates, and AI streaming |
| Push | Later, with the app: Expo push notifications | Covers iOS and Android |
| Tests | Vitest, against a real PostgreSQL: each test file gets its own copy of a migrated template database | Fast, and tests see the real triggers and constraints |
| Lint and format | ESLint with typescript-eslint (type-aware), COAL's own rules in `eslint-plugin-coal.mjs`, Prettier | Catches bugs and keeps the parts apart |
| CI | GitHub Actions: lint, type checks, formatting, tests and the website build on every push and pull request | Every change is checked |
| Hosting | Local for now; a test deployment on Railway for demos (D20); production decided later (AWS Mumbai proposed) | Simple while testing; AWS Mumbai keeps data in India |

**Sized for all of Jayon.** This stack comfortably serves about 800 employees with one backend service (several copies when needed) and one PostgreSQL database. See the next section.

## Growing to all of Jayon

COAL starts with R&D (about 60 people) and will grow to the whole company (about 800 employees). No microservices, Kubernetes, Kafka or Redis are needed for that. What matters is that adding a department doesn't mean rebuilding the base:

- **Departments, roles and processes are data.** Departments and roles are tables ([data-model.md](./data-model.md#people-and-sessions)). Each department's processes are route files run by the same engine; the R&D route is the first.
- **Platform and department modules.** The platform modules serve everyone: people, processes, tasks, documents, templates, signing, notifications, AI, audit and files. Each department gets its own module for its own records and rules. R&D's holds projects, project teams and its task routing. A lint rule (`coal/module-tables`) stops modules reaching into each other's tables: only a module's own files, other `tables.ts` files (for foreign keys) and tests may import its `tables.ts`.
- **Departments plug in.** A department's module adds its own widgets, AI tools, templates and notification rules. The platform doesn't change.
- **Ready for translation.** All website text lives in message files from the start. English first.
- **Several backend copies** share live updates through the database ([below](#events-and-live-updates)).
- **Before other departments join:**
  - real company sign-in, including a way in for employees without a company email;
  - the org chart kept by Jayon (it is in COAL as drawn, from the catalogue, for now);
  - a real admin role ([roadmap.md](./roadmap.md#after-the-first-release)); the demo admin that moves between people is removed first ([P113](./decisions.md)).

**When the stack would change**

| If… | Then |
|---|---|
| One department's work or team grows very large | Its module becomes a separate service, behind the same API |
| Permission rules outgrow code | A policy engine such as Cerbos |
| Background jobs outgrow PostgreSQL | A managed queue (AWS SQS) behind the same job interface |
| Search needs to match meaning, not just words | pgvector in the same database; a search server only if that isn't enough |

## Repository layout

```
coal/
  backend/
    src/
      core/           Plumbing every module uses: config, the database client, change() (one
                      transaction with its audit entries and events), the endpoint layer
                      (session, AI tier and permission checks, problem responses, Idempotency-Key)
      modules/        Platform modules: auth, users, org (departments and roles), permissions,
                      audit, events (the outbox), files (storage, virus scanning), process
                      (route versions, runs and their steps, decisions, milestones, send-backs),
                      tasks, templates (document types, the template library, Word files),
                      documents (documents, versions, PDFs, signature rows, step sign-off
                      records), attachments (attachments and sources), schedule (the working
                      calendar, settings, the plan and baseline, forecast and health),
                      deviations (late work, its reviews and comments), notifications (work
                      messages, reminders, the live stream), widgets (the Dashboard's data),
                      proposals (action cards), search, ai (the gateway, tools, instructions,
                      chats), research (the source library, its connectors to public sources,
                      the research assistant's runs)
                      Department modules: rnd (product lines, projects, teams, task routing,
                      and the actions that turn the engine's effects into tasks); others later
                      Each module has tables.ts, service.ts and routes.ts
      jobs/           Background jobs (pg-boss) and the worker
      server.ts       The API. worker.ts: the worker. dev.ts: both, for local work
    test/             Integration tests and their helpers
    eval/             The AI exam (`pnpm eval:ai`): questions, the made-up company, checks, the release bar and each model's baseline
    prompts/          The AI's instructions, versioned (with the AI module)
    migrations/       Database migrations, generated from the tables.ts files
  web/
    messages/         All website text, one file per language (en.json first)
    src/app/          Pages: sign-in and sign-up; Dashboard, Workstation and profile
    src/components/   Shared pieces; ui/ holds the shadcn/ui components
  app/                The mobile app (a later phase)
  shared/
    src/
      api/            The endpoint contract, the list of every endpoint, problem codes, the typed client
      schemas/        zod schemas and endpoint contracts, by area
      process/        Route definitions (YAML, one per process and version), their schema and
                      validation, and the pure engine, with tests. files.ts reads the YAML (Node
                      only; imported as @coal/shared/process-files by the backend and the tests)
      widgets/        Dashboard widget definitions and their shapes
      rules/          Small rules both clients and the backend use: names, upload limits, templates and
                      documents, drafting checks, research terms and queries, the working calendar,
                      schedule and health, and the measures
  docs/               This plan
  private/            Jayon's files on this computer, such as templates. Git-ignored: never committed
  docker-compose.yml  The local services
  eslint-plugin-coal.mjs  COAL's lint rules: part boundaries and module tables
  AGENTS.md           Rules and commands for AI coding agents (CLAUDE.md imports it)
```

Each backend module owns its tables, its services and its routes. Modules call each other through their services, not each other's tables.

**How documents reach the route.** The documents module works on a project through plain facts (`ProjectFacts`: code, name, team, product line and so on) and a `Viewer`, which the R&D module builds, so the lifecycle code doesn't depend on R&D. The R&D module tells it what the route did through hooks (`documents/signoff.ts`), called from `rnd/actions.ts` inside the action's transaction: a submitted step gets its sign-off record, an approval signs it, a return or a send-back closes it, a send-back carries each document forward, and every decision is signed. A preview runs the same hooks without writing any file, and rolls back. The files module doesn't know about documents: the route that serves a file link passes it the records to ask ("may this person see a record that holds this file?").

## The process engine

COAL runs its processes, starting with the R&D route, on its own small engine, not a workflow product. The route is paced by people over months, its rules are specific (milestones, conditional steps, rework that resets only dependent steps), and the engine's state and the audit trail must be written together.

- **Routes are files.** Each process's route lives in `shared/src/process/` as a YAML file per version (`rnd-route.v2.yaml`), checked against a strict schema (`definition.ts`) and by `validateRoute`: every step, milestone, decision and role it names exists, there are no cycles, and every send-back goes to a step the sender depends on. On deploy (`db:migrate`) the files are loaded into `process_versions`, with a hash. A loaded version never changes: a changed file is refused until it is a new version. Each run (for R&D, each project) stays on the version it started with. Besides who does what and when a step opens, a step carries its default length in working days (`default_days`) and may mark itself as the step that writes the plan (`baseline`), and the file holds the work-message templates (`messages`) with the words COAL fills in.
- **A pure engine.** `apply(route, state, action)` takes a run's state and an action (start, submit, approve, return, decide, record a milestone, send back, hold, resume, drop) and returns the new state and a list of **effects**: steps becoming ready, started, submitted, approved, done, returned, reset or cancelled; decisions and milestones recorded; the run held, resumed, dropped, completed or closed. `startRun` does the same for Go. It touches nothing else, and refuses with an `EngineError` that carries the API's problem code. It also answers questions the screens need: what a step waits for, what it can do now (`stepActions`), and who may hold or drop (`runActionRoles`).
- **Opening steps.** After every action the engine opens each step whose conditions hold, until nothing changes. A send-back closes the iterations of the step and of everything that depends on it, and reopens the target at once.
- **One transaction per action.** Each action runs in one database transaction, in `backend/src/modules/rnd/actions.ts`:
  1. lock the run, so actions on one project happen one after the other;
  2. check the permission (the role the route names, and the person's scope);
  3. run the engine;
  4. save the new state (a send-back closes the old iteration rows and adds new ones);
  5. turn the effects into tasks, audit entries and events (see below).
- **Previews.** The same code runs inside the transaction and rolls back at the end (`previewable()` in `core/db/change.ts`). A preview can't drift from the real action, because it is the real action.
- **Conditions are named rules** written in code and used by name in the route file: `step_approved`, `step_done`, `milestone_reached`, `decision_equals`, `decision_recorded`, `no_open_corrective_actions`.
- **Tests.** Table-driven tests walk whole projects through the route in seconds (`shared/src/process/engine.test.ts`), including every rework path, both paths of step 15, the Board's two signatures, hold and drop, and the milestones. API tests (`backend/test/route.test.ts`) walk it through the real endpoints, with the permissions, tasks and audit trail.

```yaml
process: rnd-route
version: 2                     # Jayon's workflow page, revision 2 (16 Nov 2026)
steps:
  - key: "10"
    name: Implant prototype
    stage: 3
    doers: [pme, qc_inspector]
    signer: rd_lead
    starts_when:
      - { step_approved: "7" }
      - { milestone_reached: material_received_implant }
      - { milestone_reached: test_licence_recorded }
    outputs: [Material Issue Slip, Run card, Prototype Approval Form]
    send_back:
      - { to: ["7"], decided_by: rd_head }
    assumptions: [W3, W11]               # open questions this step relies on
  - key: "15"
    name: Pre-clinical study
    stage: 4
    doers: [rd_ops, dard]
    signer: rd_lead
    starts_when: [{ step_approved: "13" }]
    path:                                # the Head's answer at step 12 chooses the outputs
      decided_at: { step: "12", decision: preclinical_needed }
      options:
        - { value: "yes", name: Study, outputs: [Animal or cadaver study report] }
        - { value: "no", name: Justification, outputs: [Justification that no study is needed] }
    outputs: []
```

The full step list is in [workflow.md](./workflow.md). When the route changes, update the YAML, its tests and `workflow.md` together.

## API

REST and JSON under `/api/v1`. The details and the endpoint list are in [api.md](./api.md). In short:

- **The contract.** Each endpoint is defined once in `shared/` with `defineEndpoint`: its path, schemas, whether it needs a session, its permission and its AI tier. The backend implements it, the website calls it through the typed client built from the same definition, and the OpenAPI spec is generated from it (`/api/v1/openapi.json`, with `x-permission` and `x-ai-tier` on each operation).
- **AI tier.** Every endpoint declares its permission and its AI tier ([workstation-and-ai.md](./workstation-and-ai.md#what-the-ai-may-do)). Before validating the input, the backend checks, in order: the session, the AI tier for "via AI" calls, then the permission.
- **Kept complete.** The backend refuses to start if an endpoint in `shared/` has no implementation, and the type check fails if a permission has no rule.
- **Sessions.** The website sends the user's session token in a cookie. The backend already accepts it as a bearer token too, for the app later.

## Events and live updates

- **The outbox.** Every change writes **events** (for example `step.ready`, `task.assigned`, `signature.requested`) to an outbox table, in the same transaction.
- **Delivery.** A worker reads the outbox and passes each event to its subscribers (`backend/src/modules/events/subscriptions.ts`), in the same transaction that marks it delivered. A failed delivery is retried later, with growing gaps. The subscribers so far:
  - the notification sender (work messages written from the route's templates, one per person and event);
  - live updates to open clients (below).

  Recalculating the forecast doesn't wait for an event: it happens in the same transaction as the change that moves it (and nightly). Search joins later.
- **Live updates.** Each signed-in client keeps one Server-Sent Events stream (`GET /api/v1/stream`). It carries hints only: "these widgets changed" and "you have a new notification", never content, and the website fetches the data through the normal API. The mobile app, when it comes, uses the stream while open and push notifications otherwise.
- **Several backend copies.** A trigger sends `NOTIFY coal_outbox` when events are written, so the workers wake at once, and each also polls as a fallback. Workers claim events with `SKIP LOCKED`, so each event is delivered once. The live hints go through PostgreSQL's LISTEN/NOTIFY too (`coal_live`): the subscriber sends one when it delivers an event, and every API copy that has a client connected listens and passes it on, so no extra server is needed.
- **The event list** is in [api.md](./api.md#events).

## AI module

The AI lives inside the backend (`backend/src/modules/ai/`) for now. It can be split out later without changing the API.

- **Gateway** (`provider.ts`, `gateway.ts`). A provider adapter runs one turn: instructions, earlier messages and tools in, streamed words and token counts out. There are three: Anthropic through the Vercel AI SDK (`anthropic.ts`), the Copilot SDK as a temporary development stand-in (`copilot.ts`, [D19](./decisions.md)), and a scripted one for tests. The settings choose one (`AI_PROVIDER`) and a model for each purpose (`pricing.ts` turns tokens into the cost that sets budgets). It is `deps.ai`, null where the AI isn't set up.
- **The reply** (`turn.ts`). Checks the budget, saves the message, builds the instructions (`prompts/`), runs the model with the person's tools, streams the words, then saves the reply and its logs in one transaction.
- **Tools** (`tools.ts`, `toolbox.ts`) are thin wrappers over the backend's own endpoints, run through `callEndpoint` (`core/http/call.ts`): the same input checks, session, AI tier, permission and handler as a request.
  - Each call carries the user's identity and a "via AI" mark.
  - `confirm`-tier endpoints accept "via AI" calls only to create proposals; `never`-tier ones refuse them outright; the tools are only built on `read` and `auto` endpoints.
  - Refusals go back to the model as text.
- **Proposals** (`backend/src/modules/proposals/`) run each action through its endpoint's own handler, as the user, inside one transaction: rolled back for the preview, committed on confirm ([api.md](./api.md#proposals-and-action-cards)).
- **Chats** are kept in the database. Replies stream to the client over Server-Sent Events from the same endpoint that takes the message. One reply runs at a time per chat, and its stop button reaches only the API copy that is writing it ⚠.
- **Channels.** The chat is channel-neutral. A channel passes in messages and gets back parts (text with citations, what was looked at, action cards), which it shows in its own way. The website is the first channel; WhatsApp and the app come later ([workstation-and-ai.md](./workstation-and-ai.md#channels)).
- **Templates.** A template is Jayon's Word form as it is; the assistant looks up the approved one every time and fills a copy of it in place ([documents-and-signing.md](./documents-and-signing.md#the-template-library), [workstation-and-ai.md](./workstation-and-ai.md#filling-a-form-with-the-assistant)). Filling templates in COAL from a specification (placeholders, fields from records, drafting) is parked behind one setting, `TEMPLATE_FILLING` (default off), which `GET /me` reports as `features` so the website hides it ([P109](./decisions.md)).
- **Search.** `GET /search` and the AI find projects, documents, tasks and people with PostgreSQL full-text search (a GIN index on each document version's text), and each kind is filtered by its own permission rule before it is returned. Vector search comes later.
- **Logged.** Every reply and tool call is recorded: who, which model, tokens, cost, the tools used and the records returned. Logs never hold the person's words or the answers.
- **Research** (`backend/src/modules/research/`, [workstation-and-ai.md](./workstation-and-ai.md#researching-what-already-exists)). A run is confirmed on a card, saved with a `research.requested` event, and handed by the worker to a job. The job runs a separate model turn with two tools of its own (not endpoint wrappers): each searches only the library's sources, through one connector per kind (`connectors/`). The connectors reach the outside world only through `deps.fetchOutside` (a stand-in in tests), call only their own fixed hosts, one request at a time per host with a gap between, and keep answers for ten minutes. A website is searched by the provider's web search (`searchWeb`), where it has one.

## Sign-in and sessions

- **Name-only sign-in, for now.** A placeholder module ([roles-and-access.md](./roles-and-access.md#accounts-for-now)) creates accounts and signs people in by name. It issues an opaque session token; the database keeps only its SHA-256 hash. Sessions last 14 days (a setting), and sign-up and sign-in are rate-limited.
  - the website keeps it in an HTTP-only, SameSite=Lax cookie (`coal_session`);
  - later, the app keeps it in the device's secure storage and sends it as a bearer token.

  Replacing this module with real sign-in later doesn't change the rest of the backend.
- **Passkeys** are registered and used only for signing ([documents-and-signing.md](./documents-and-signing.md#signing-with-face-id-or-fingerprint)). They're tied to COAL's web address. They work on `localhost` while testing, and passkeys made on a demo host are registered again once the final domain is set; the domain is decided at the end. When the mobile app comes, it must be linked to that domain (Associated Domains on iOS, Digital Asset Links on Android) to use the same passkeys.

## Background jobs

pg-boss runs:

- the morning reminders and escalations (08:30 Indian time; nothing goes out on a day off);
- the nightly recalculation of every running project's dates and health (00:10 Indian time);
- the daily audit-chain check (02:30 Indian time);
- removing stored Idempotency-Key responses after a day;
- the virus-scan sweep (every minute, for uploads the scanner couldn't reach);
- research runs (`research.run`, as each confirmed run's event is delivered, two at a time per worker), and a sweep every minute that sends again a run left waiting and ends one a stopped worker left running.

Documents are rendered while a version is saved, not by a job, so a version never exists without its PDF. The price is that the save holds the project's lock while Gotenberg works (it gives up after 30 seconds, `PDF_TIMEOUT_MS`), and the render uses the save's own database connection so a slow service can't starve the connection pool. Fine for R&D's size; a render job is the answer if saves ever queue up.

Jobs are written so that running one twice does no harm: each reminder carries a key that stops a repeat to the same person.

**Time.** The backend reads "now" from one place (`deps.now`), so due dates, reminders, task stamps and the lateness rules agree, and tests move the clock forward instead of waiting. Dates are calendar days in Indian time (`YYYY-MM-DD`); instants are UTC.

## Security basics

- **Encryption.** TLS everywhere, and storage and database encryption.
- **Secrets** live in a secrets manager, never in the code.
- **Database accounts.** The backend's database account can't change or delete audit entries or signatures, and can't change what a saved document version holds (triggers refuse it now; in production the account will also lack the privileges).
- **Uploads** are virus-scanned (ClamAV, required in production) and limited by type and size. Clients upload to a staging area; COAL checks the bytes and copies them to where they're served from, so a file's recorded hash always matches what's served. Files are served only through short-lived links, after a check that the person may see a record that holds the file. Word templates are also refused if they would unpack to something huge (a zip bomb), and only `http` and `https` links are accepted as sources. In production, a storage rule removes staged uploads left unfinished after a day.
- **Rate limits** on sign-in and the AI endpoints, counted per address. The backend believes `X-Forwarded-For` only from the reverse proxies named in `TRUST_PROXY`, and only a proxy that overwrites that header with the connecting address may be named. The website's own rewrite passes a browser's header through, so it's never trusted: locally and on the test deployment, where no such proxy stands in front of `/api/v1`, everyone shares one counter.
- **Logs** never contain document content, prompts or AI results. Error reports are scrubbed before they're stored.
- **Calls outside.** The backend calls nothing outside except the AI provider and, for research, a fixed list of public hosts (NCBI, Europe PMC, ClinicalTrials.gov, openFDA, Crossref), with only the words a person confirmed ([workstation-and-ai.md](./workstation-and-ai.md#safety-basics)).
- **The AI.** Every measure that keeps it safe, and how it is tested, is in [ai-safety.md](./ai-safety.md).

## Environments and hosting

| Environment | What | Data |
|---|---|---|
| Local | Docker Compose: PostgreSQL 18, Gotenberg, and MinIO (the `pgsty/minio` community build, since MinIO stopped publishing images); the backend creates its bucket | Made-up |
| Demo, when needed | The test deployment on Railway: the same pieces as local, built from `backend/Dockerfile` and `web/Dockerfile`, updated by pushing to `main` ([demo-hosting.md](./demo-hosting.md), D20) | Made-up |
| Production | Decided at the end (AWS Mumbai proposed), with daily backups and point-in-time restore | Real Jayon data, **only once real sign-in exists** |

When the mobile app comes, it's tested through Expo's internal distribution or TestFlight first.

Madhav's hosting research and monthly cost estimates are in [archive/PLAN.md, Part 10](./archive/PLAN.md#part-10--hosting-and-running-cost). Re-check them before quoting.
