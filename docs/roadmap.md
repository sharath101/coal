# Roadmap

**Read this when** you plan work, need to know whether something is in the first release, or are about to build something listed as "later".
**Related:** [decisions.md](./decisions.md) for why, [open-questions.md](./open-questions.md) for what's blocking.

This roadmap gives an **order, not dates**. Madhav's effort estimates and costs are in [archive/PLAN.md, Parts 10 and 11](./archive/PLAN.md#part-11--build-plan), for reference.

---

## The first release

**Goal:** the whole R&D route works end to end, with made-up data, on the website and in the mobile app, with basic AI.

### What's in it

| Area | In the first release | Doc |
|---|---|---|
| Accounts | Sign up by name and role; sign in by name (placeholder); no admin | [roles-and-access.md](./roles-and-access.md#accounts-for-now) |
| The route | All 28 steps, checkpoints, milestones (recorded by hand), step 15's two paths, sending work back, hold and drop | [workflow.md](./workflow.md) |
| Tasks | Tasks from the route; assigning work, requests, role queues, comments | [roles-and-access.md](./roles-and-access.md#assigning-work-and-making-requests) |
| Access | Status visible to everyone; content need-to-know; one permission module with tests | [roles-and-access.md](./roles-and-access.md#how-access-is-enforced) |
| Documents | Templates for stage 1 and 2; uploads for everything else; versions; PDFs; pictures and sources | [documents-and-signing.md](./documents-and-signing.md) |
| Signing | Face ID or fingerprint passkeys on the website and in the app; signature rows; step sign-off records; signed decisions; audit trail | [documents-and-signing.md](./documents-and-signing.md#signing-with-face-id-or-fingerprint) |
| Dashboard | The widget framework; widgets W1 to W10; the project page; dates, forecast, reminders, deviations; in-app and push notifications | [dashboard.md](./dashboard.md) |
| Workstation and AI | Chat by project; the five AI features, only when asked; action cards; Claude and OpenAI behind one gateway; tests against both | [workstation-and-ai.md](./workstation-and-ai.md) |
| Platform | Backend, website, mobile app and shared code; local setup; staging in AWS Mumbai | [architecture.md](./architecture.md) |

### Build order

Each block depends on the ones before it. Within a block, the work can run side by side.

1. **Foundations**
   - The monorepo (pnpm workspaces): `backend/`, `web/`, `app/`, `shared/`.
   - Linting, type checks and tests on every change.
   - Docker Compose for local work.
   - The backend skeleton: Fastify, Drizzle and migrations, pg-boss, schemas in `shared/`, OpenAPI generation.
   - Name-only accounts and sessions.
   - The permission module and its test table.
   - The audit trail and the event outbox.
   - File storage.
   - Website and app skeletons with the Dashboard and Workstation toggle.
   - Staging on AWS Mumbai.
2. **The route**
   - The route definition (version 2) in YAML, and the pure engine, with tests for every step, rework path, branch and milestone.
   - Projects, project steps, tasks and their routing; Go as a plain form.
   - Decisions, sending work back, milestones, hold and drop.
3. **Documents and signing**
   - Document types and the stage 1 and 2 templates; uploads, versions, comparison and PDFs.
   - Passkey registration and signing, on the website and in the app.
   - Signature rows, step sign-off records, and signed decisions (Go included).
4. **Dashboard**
   - The widget framework, on the website and in the app; W1 to W10; the project page.
   - Dates from the route and then from the Action Plan; the forecast; reminders and escalation; deviations.
   - Notifications in the app and by push.
5. **Workstation and AI**
   - The chat screens, on the website and in the app.
   - The AI gateway with Anthropic and OpenAI; read tools; proposals and action cards.
   - The five AI features: questions, idea to project, drafting, assigning work, explaining documents.
   - The AI test sets, run against both providers; budgets and logging.

### Done when

- **The route works end to end.** A made-up project goes from idea (Go) to launch in staging:
  - every step is signed with Face ID or a fingerprint, on both the website and the app;
  - at least one send-back is exercised (13 → 7);
  - both paths of step 15 are exercised.
- **The Dashboards work.** Every role's Dashboard shows the right live data, and nobody sees content they shouldn't.
- **The AI works.** With both providers, it:
  - answers questions with citations;
  - turns an idea into a previewed project;
  - drafts the stage 1 and 2 documents from their templates;
  - assigns work through action cards.
- **The tests pass.** All engine, permission and AI tests are green.

## After the first release

The likely next steps. Their order is decided as we learn, mostly by what the first real project will reach next.

1. **Real sign-in and admin:**
   - company sign-in;
   - an admin role;
   - the org chart and real reporting lines;
   - several roles per person.

   This must come before any real Jayon data.
2. **More templates:** the FEA report, QC inspection report, Prototype Approval Form, testing parameters report, case study and Transfer Approval Form, as Jayon provides them.
3. **Step modules**, one at a time, each designed from Jayon's real documents ([data-model.md](./data-model.md#not-modelled-yet-on-purpose)):
   - sourcing (6, 9);
   - design and FEA (7, 8);
   - prototypes, run cards, QC, machines and costing (10, 11);
   - testing (13);
   - feedback and pre-clinical work (14, 15);
   - trials (19, 20);
   - regulatory work, transfer and launch (2a, 22 to 25).
4. **Ready for official records:** the checklist in [regulatory-notes.md](./regulatory-notes.md#before-coal-holds-official-records).
5. **More AI:**
   - runs that start when a task opens, following playbooks;
   - AI-written work messages and a daily briefing;
   - the research assistant;
   - meeting minutes;
   - the outside-document reader;
   - vector search;
   - routing by data sensitivity.
6. **Connectors:** SolidWorks (read and export first), the ERP (read-only first), shop-floor tablets.
7. **WhatsApp:** alerts, then the AI bot on the same API.

## Later

Everything deliberately left out of the first release, and why:

| Item | Why not now | Noted in |
|---|---|---|
| Real authentication, admin role, org chart, several roles per person | Not decided yet; name-only accounts let us build everything else | [roles-and-access.md](./roles-and-access.md#later) |
| Step modules (materials, design, prototypes, QC, machines, costing, testing, trials, regulatory, transfer) | Need Jayon's real documents and answers; designing from guesses creates rework | [data-model.md](./data-model.md#not-modelled-yet-on-purpose) |
| Regulatory gates beyond hand-recorded milestones | Need the full picture, Jayon's agreement and legal advice | [regulatory-notes.md](./regulatory-notes.md) |
| Sealed PDFs, Aadhaar eSign or DSC, identity checks and e-signature agreements | Only matter for official records, which need real sign-in first | [documents-and-signing.md](./documents-and-signing.md#later) |
| Signing on someone's behalf during leave | Needs real identity and admin | [roles-and-access.md](./roles-and-access.md#later) |
| Sensitivity labels, compartments, row-level security | The simple content rules are enough for made-up data | [roles-and-access.md](./roles-and-access.md#later) |
| AI runs that start on their own, playbooks, AI work messages and briefings | Decided: the AI runs only when asked, for now | [workstation-and-ai.md](./workstation-and-ai.md#later) |
| Research assistant, meeting minutes, outside-document reader, vector search | Useful, but not needed to prove the base | [workstation-and-ai.md](./workstation-and-ai.md#later) |
| SolidWorks and ERP connectors, shop-floor tablets, machine data | Need Jayon's IT details and the step modules first | [archive/PLAN.md §5.5, §5.6](./archive/PLAN.md#55-cad-the-solidworks-connector) |
| WhatsApp alerts and bot | Come after the API is stable; the bot reuses it | [architecture.md](./architecture.md#the-parts) |
| More widgets, trends, personal layouts, email digest | Come with the data they need | [dashboard.md](./dashboard.md#later) |
| Cost estimates and durations | Not needed to start building; Madhav's figures are archived | [archive/PLAN.md, Part 10](./archive/PLAN.md#part-10--hosting-and-running-cost) |
| A mobile-specific scope (offline use, kiosk mode, mobile-only features) | Decided: the app matches the website for now; explore later | [decisions.md](./decisions.md) |

## Not planned

These were in one of the earlier plans and were deliberately dropped. Reopen them only with a reason.

- **Keycloak and Cerbos:** more infrastructure than about 60 users need. The backend's own sessions and permission module do the job.
- **A separate AI agent service and tool server (MCP):** the AI module inside the backend is enough. An MCP server may come back with the SolidWorks connector.
- **Opt-in consent for background AI:** there is no background AI for now.
- **A vault for patient identities:** patients will never be named in COAL.
- **A trial of commercial quality systems:** only if Jayon's QA team asks for one.
