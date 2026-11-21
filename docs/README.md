# COAL: the plan

**Status:** base version 1, 18 November 2026. This plan is improved step by step; it isn't meant to be complete yet.
**Built from:** Jayon's R&D workflow (revision 2) and the two earlier plans, now in [archive/](./archive/README.md).

This is the main doc. It gives the whole picture on one page and points to the doc that holds the detail. **Start here, then read only the docs your task needs.**

---

## The plan on one page

**What COAL is.** An AI-assisted platform that runs Jayon's R&D: from the VP's product idea, through 28 steps, to the launch. Every person sees their own work and what matters to them, and has an AI assistant to help with it. Jayon is an orthopaedic implant maker; its R&D product lines are Arthroscopy, Spine and Trauma. COAL starts with R&D and is built to grow to the whole company, about 800 employees.

**Two pages per person**, on the website first (WhatsApp and a mobile app come later):

- **Dashboard:** expandable widgets that answer three questions: *What needs me now? What's coming? How are we doing?* → [dashboard.md](./dashboard.md)
- **Workstation:** a chat assistant organised by project, where people ask questions, draft documents, assign work and sign. The same chat comes to WhatsApp later → [workstation-and-ai.md](./workstation-and-ai.md)

**How work moves.**

1. The VP describes an idea and says **Go**, a signed decision. COAL creates the project and opens the first steps.
2. Each step opens when its inputs are signed. Its doers get tasks, and its signer signs it off.
3. Checkpoints (4, 12, 18, 23) gate everything after them. Failures send work back to earlier steps as new iterations.
4. Dates come from the signed Action Plan. Late work needs a reason.

→ [workflow.md](./workflow.md)

**The AI** helps only when asked:

- it answers questions;
- turns an idea into a project;
- drafts documents from Jayon's templates, always loading the current one from COAL's template library;
- assigns work;
- explains documents before you sign;
- researches what already exists (products, studies, trials, safety problems) in the public sources Jayon chose, with search words you confirm.

It acts as you, sees only what you can see, and anything that affects other people needs your confirmation on an action card. It never signs or decides. It runs on Claude (Anthropic). → [workstation-and-ai.md](./workstation-and-ai.md)

**Signing.** Documents and decisions are signed in rows (Prepared, Reviewed, Approved), each signature tied to the exact version's hash. Until the last block it is a confirmed click; then Face ID or a fingerprint (passkeys). Everything is recorded in an add-only audit trail. → [documents-and-signing.md](./documents-and-signing.md)

**Who sees what.** Everyone sees every project's status. Content is need-to-know, by role and project team. → [roles-and-access.md](./roles-and-access.md)

**Accounts, for now.** Sign up with a name and a role; sign in with your name. This is a placeholder until real authentication is chosen, so COAL holds **made-up data only** until then. → [roles-and-access.md](./roles-and-access.md#accounts-for-now)

**How it's built.** A separate backend (its API also serves the WhatsApp chat and the mobile app later), a Next.js website, and shared TypeScript code, on PostgreSQL. Platform modules serve every department, and each department adds its own. It runs locally for now; demos use a test deployment on Railway ([demo-hosting.md](./demo-hosting.md)). → [architecture.md](./architecture.md)

**First release.** The whole route, end to end, with made-up data, on the website, with basic AI and the template library. Step-specific modules (prototypes, QC, trials, regulatory) come after, designed from Jayon's real documents. → [roadmap.md](./roadmap.md)

## Principles

These hold everywhere. If a change breaks one, raise it first.

1. **People decide; the AI prepares.** The AI never signs, decides, or sends anything outside Jayon on its own: research sends only the general search words a person confirms on a card ([P97](./decisions.md)). Changes that affect others need a person's confirmation.
2. **Facts come from records.** Numbers, dates, names and statuses come from the database, with their source, never from the AI.
3. **The backend enforces the rules.** Permissions, AI tiers and signatures are checked in the backend, never only in a client or in the AI's instructions.
4. **Processes are data.** Jayon's processes, starting with the R&D route, live in versioned definitions, not in code. Projects stay on the version they started with.
5. **Nothing important is overwritten.** Versions, signatures, decisions and the audit trail are add-only.
6. **Build from real information.** Don't design tables or rules from guesses. Mark assumptions ⚠ and list them in [open-questions.md](./open-questions.md).
7. **Keep it simple.** Build the smallest thing that works, and leave room to grow.
8. **Build for all of Jayon.** Platform code serves every department; anything specific to R&D stays in R&D's module ([architecture.md](./architecture.md#growing-to-all-of-jayon)).

## Key decisions

The full log, with reasons, is in [decisions.md](./decisions.md).

- **Scope:** R&D first, built to grow to all of Jayon, about 800 employees (D11).
- **Parts:** a separate backend, website and mobile app, with shared code (D1). Web first; the app comes in a later phase (D12).
- **Hosting:** local first; a test deployment on Railway for demos (D13, D20); the domain and production hosting are decided at the end (D13).
- **AI:** Claude (Anthropic) behind one gateway (D17, replacing D2), with a budget of US$5 per person per day (D18); the Copilot SDK stands in on one development laptop for now (D19). Basic AI in the first release, only when asked (D3). The chat also comes to WhatsApp (D14).
- **Templates:** a template for each step's documents, kept in COAL's template library; the AI checks it every time (D15).
- **Signing:** Face ID or fingerprint passkeys, with the device PIN as fallback (D4), built last (D16). A confirmed click until then.
- **Accounts:** name and role sign-up, and name sign-in, for now; no admin (D5).
- **Visibility:** project status visible to everyone (D6).
- **Dashboard:** expandable widgets (D7).
- **Regulatory:** reference only until we have the full picture (D8).

## The docs

| Doc | What it covers |
|---|---|
| [workflow.md](./workflow.md) | Jayon's R&D route: the 28 steps, who does and signs each one, when each starts, checkpoints, decisions, milestones, rework |
| [roles-and-access.md](./roles-and-access.md) | Roles, accounts, project teams, who sees what, who can do what, assigning work, task routing, enforcement |
| [dashboard.md](./dashboard.md) | Widgets, layouts, the project page, measures, health, deadlines and deviations, notifications |
| [workstation-and-ai.md](./workstation-and-ai.md) | The Workstation, the AI's features, tiers and action cards, the main flows, channels (website, WhatsApp, app), AI providers, safety, AI tests |
| [documents-and-signing.md](./documents-and-signing.md) | Documents, the template library, versions, signature rows, step sign-off records, passkey signing, audit trail, files |
| [architecture.md](./architecture.md) | The parts, stack, growing to all of Jayon, repo layout, process engine, events, AI module, sign-in, jobs, security, hosting |
| [demo-hosting.md](./demo-hosting.md) | The test deployment on Railway: its pieces and settings, updating, filling and resetting it |
| [api.md](./api.md) | API conventions, every first-release endpoint with its AI tier, proposals, events |
| [data-model.md](./data-model.md) | Conventions and the first-release tables; what isn't modelled yet |
| [regulatory-notes.md](./regulatory-notes.md) | Reference only: what the rules may require, and what's needed before COAL holds official records |
| [roadmap.md](./roadmap.md) | First release scope and build order, what comes next, what's later, what's not planned |
| [decisions.md](./decisions.md) | Every decision, with why |
| [open-questions.md](./open-questions.md) | Unanswered questions and the assumptions used meanwhile; inputs needed from Jayon |
| [glossary.md](./glossary.md) | Words and abbreviations |
| [source/](./source/jayon-rnd-workflow-rev2.html) | Jayon's workflow page (revision 2), the source of the route |
| [archive/](./archive/README.md) | The earlier plans. History, not the current plan |

## Which docs to read for a task

| If you're working on… | Read |
|---|---|
| The process engine, steps, gates or rework | [workflow.md](./workflow.md), [architecture.md § The process engine](./architecture.md#the-process-engine) |
| Accounts, sign-in, permissions or task assignment | [roles-and-access.md](./roles-and-access.md) |
| An API endpoint | [api.md](./api.md), plus the doc for its area |
| A database table or migration | [data-model.md](./data-model.md), plus the doc for its area |
| A Dashboard widget, dates, alerts or notifications | [dashboard.md](./dashboard.md) |
| The Workstation, the AI, a tool, a prompt or a chat channel | [workstation-and-ai.md](./workstation-and-ai.md) |
| How a request is processed, step by step, and where it can stop | [workstation-and-ai.md § How a reply is made](./workstation-and-ai.md#how-a-reply-is-made) |
| Research, the source library or a connector to a public source | [workstation-and-ai.md § Researching what already exists](./workstation-and-ai.md#researching-what-already-exists) |
| A template or the template library | [documents-and-signing.md § The template library](./documents-and-signing.md#the-template-library) |
| Documents, versions or signing | [documents-and-signing.md](./documents-and-signing.md) |
| The repo setup, the stack, hosting or security | [architecture.md](./architecture.md) |
| Deploying, updating or resetting the test deployment | [demo-hosting.md](./demo-hosting.md) |
| A new department or process | [architecture.md § Growing to all of Jayon](./architecture.md#growing-to-all-of-jayon), [data-model.md](./data-model.md), [roles-and-access.md](./roles-and-access.md) |
| A new step module (prototypes, QC, testing, trials…) | [roadmap.md](./roadmap.md), [data-model.md § Not modelled yet](./data-model.md#not-modelled-yet-on-purpose), [regulatory-notes.md](./regulatory-notes.md), [workflow.md](./workflow.md) |
| Deciding what to build next | [roadmap.md](./roadmap.md), [open-questions.md](./open-questions.md) |
| An unfamiliar term | [glossary.md](./glossary.md) |

## Repository layout

```
coal/
  backend/   The API, process engine (database side), AI module, workers
  web/       The website
  app/       The mobile app (a later phase)
  shared/    Schemas and types, route definitions and the pure engine, widget definitions
  docs/      This plan
  private/   Jayon's files on this computer, such as templates. Git-ignored: never committed
  AGENTS.md  Rules for AI coding agents (CLAUDE.md imports it)
```

Details: [architecture.md § Repository layout](./architecture.md#repository-layout).

## Keeping the docs up to date

The docs are the plan. Keep them true:

1. **Update docs in the same change.** A change to behaviour, an endpoint, a table, the route or a decision updates its doc in the same commit or pull request.
2. **One home per fact.** Each topic lives in one doc (the map above). Other docs link to it rather than repeating it. If you find the same fact in two places, keep one and link to it.
3. **Decisions go in the log.** Add the decision to [decisions.md](./decisions.md), update every doc it affects, and update [Key decisions](#key-decisions) above if it's a key one.
4. **Answered questions are closed.** Move them to "Answered" in [open-questions.md](./open-questions.md), and remove the ⚠ wherever the assumption was used.
5. **When Jayon's route changes:**
   - add the new workflow page to [source/](./source/);
   - update the route definition and its tests in `shared/`;
   - update [workflow.md](./workflow.md) and record the decision.
6. **Where each kind of change goes:**

   | Change | Doc |
   |---|---|
   | New endpoint | [api.md](./api.md) |
   | New table | [data-model.md](./data-model.md) |
   | New widget | [dashboard.md](./dashboard.md) |
   | New AI feature, tool or tier | [workstation-and-ai.md](./workstation-and-ai.md) |
   | New role or access rule | [roles-and-access.md](./roles-and-access.md) |
   | New department or process | [architecture.md](./architecture.md#growing-to-all-of-jayon), [data-model.md](./data-model.md), [roles-and-access.md](./roles-and-access.md) |
   | Moving something from "later" into scope | [roadmap.md](./roadmap.md), plus the area doc |
7. **Mark assumptions.** Put ⚠ next to anything assumed, and give it an entry in [open-questions.md](./open-questions.md).
8. **Keep docs small.** Each doc stays focused, under about 20 KB. If one grows past that, split it and update the map above.
9. **Plain language.** Short sentences, everyday words, and tables for anything with several attributes.
10. **Leave the archive alone.** Don't edit [archive/](./archive/README.md), except to fix links. Don't treat it as current. Re-check anything you take from it.
