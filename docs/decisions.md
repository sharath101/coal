# Decisions

**Read this when** you need to know why something is the way it is, or before reversing a choice.
**Related:** [open-questions.md](./open-questions.md) for what isn't decided yet.

---

## How to add or change a decision

1. **Add a row.** Use the next ID in the right group, with the date and who decided.
2. **Never delete a decision.** If a new one reverses an old one, mark the old row *Replaced by Xn* and keep it.
3. **Update the docs.** In the same change, update every doc the decision affects (the "Docs" column), and the summary in [README.md](./README.md#key-decisions) if it's a key decision.
4. **Close the question.** If the decision answers a question in [open-questions.md](./open-questions.md), mark that question answered and link here.

**Groups**

- **D:** taken by the founders.
- **B:** the basics both earlier plans agreed on.
- **P:** proposed by the AI assistant when writing this plan, and accepted with it. P decisions are the easiest to revisit.

## Founders' decisions

| ID | Date | Decision | Why | Docs |
|---|---|---|---|---|
| D1 | 18 Nov 2026 | A separate backend, website and mobile app, plus shared code, in one repository | The API must also serve a future WhatsApp AI bot and other clients | [architecture.md](./architecture.md) |
| D2 | 18 Nov 2026 | Integrate both Claude (Anthropic) and OpenAI behind one gateway; choose later | Keep the option open, and compare them on real tasks | [workstation-and-ai.md](./workstation-and-ai.md#ai-providers) |
| D3 | 18 Nov 2026 | Basic AI is in the first release, and it runs only when a person asks | Show the AI early, and keep it simple and predictable | [workstation-and-ai.md](./workstation-and-ai.md) |
| D4 | 18 Nov 2026 | Signatures use Face ID or a fingerprint (passkeys), with the device's PIN as fallback | Easy for people, strong, and only a person's own device can sign | [documents-and-signing.md](./documents-and-signing.md#signing-with-face-id-or-fingerprint) |
| D5 | 18 Nov 2026 | For now, accounts are created with a name and a role, and people sign in by name. No admin. Real authentication later | Authentication isn't decided; this lets everything else be built | [roles-and-access.md](./roles-and-access.md#accounts-for-now) |
| D6 | 18 Nov 2026 | Everyone can see the status of every project | Coordination and visibility across R&D | [roles-and-access.md](./roles-and-access.md#what-people-can-see) |
| D7 | 18 Nov 2026 | The Dashboard is made of expandable widgets | The original product idea | [dashboard.md](./dashboard.md) |
| D8 | 18 Nov 2026 | Regulatory findings are reference only; no tables or designs until we have the full picture | Avoid building on assumptions | [regulatory-notes.md](./regulatory-notes.md) |
| D9 | 18 Nov 2026 | *Replaced by D12.* The mobile app has the same features as the website for now | Explore a mobile-specific scope later | [architecture.md](./architecture.md#the-parts) |
| D10 | 18 Nov 2026 | Earlier plans moved to `docs/archive/`; this plan replaces them | One current plan | [archive/README.md](./archive/README.md) |
| D11 | 18 Nov 2026 | COAL starts with R&D and will grow to cover all of Jayon, about 800 employees. The base is built so other departments can be added without rebuilding it | The long-term goal is the whole company | [architecture.md](./architecture.md#growing-to-all-of-jayon) |
| D12 | 18 Nov 2026 | Web first. The first release is the website; the mobile app, with push notifications, comes in a later phase | Focus on one client first | [roadmap.md](./roadmap.md) |
| D13 | 18 Nov 2026 | Local first. Demos for employees use simple hosting. The web domain and production hosting are decided at the end | We are still testing locally | [architecture.md](./architecture.md#environments-and-hosting) |
| D14 | 18 Nov 2026 | The AI chat will also be offered on WhatsApp | Planned by the founders; the API was kept separate for this (D1) | [workstation-and-ai.md](./workstation-and-ai.md#channels) |
| D15 | 18 Nov 2026 | The founders provide a template for each step's documents. COAL keeps them in a template library, and the AI checks it for the current template every time it makes a document | Every step's documents can be drafted from Jayon's own forms | [documents-and-signing.md](./documents-and-signing.md#the-template-library) |

## Basics both earlier plans agreed on

| ID | Decision | Docs |
|---|---|---|
| B1 | Two pages per person: Dashboard and Workstation | [dashboard.md](./dashboard.md), [workstation-and-ai.md](./workstation-and-ai.md) |
| B2 | The R&D route is versioned data run by COAL's own small engine. Each project stays on the version it started with | [workflow.md](./workflow.md), [architecture.md](./architecture.md#the-process-engine) |
| B3 | People decide and sign; the AI only prepares. The AI never signs, approves or sends anything outside Jayon | [workstation-and-ai.md](./workstation-and-ai.md#what-the-ai-may-do) |
| B4 | Facts (numbers, dates, names, statuses) come from records, never from the AI, and are shown with their source | [workstation-and-ai.md](./workstation-and-ai.md#how-the-ai-works-in-the-first-release) |
| B5 | The AI acts as the person who asked, with exactly their permissions | [roles-and-access.md](./roles-and-access.md#how-access-is-enforced) |
| B6 | Documents are made from Jayon's own Word boilerplates: fields from records, written sections by people or the AI | [documents-and-signing.md](./documents-and-signing.md#the-template-library) |
| B7 | Signature rows Prepared, Reviewed, Approved; every signature tied to the exact version's hash; nothing editable afterwards | [documents-and-signing.md](./documents-and-signing.md#signature-rows) |
| B8 | An add-only, hash-chained audit trail, written in the same transaction as each change | [documents-and-signing.md](./documents-and-signing.md#audit-trail) |
| B9 | TypeScript, PostgreSQL and Next.js; hosting in India | [architecture.md](./architecture.md#stack) |
| B10 | Rework opens a new iteration of a step; history is never edited | [workflow.md](./workflow.md#failure-and-rework) |

## Proposed with this plan (18 Nov 2026)

| ID | Decision | Why | Docs |
|---|---|---|---|
| P1 | The docs are split into one main doc and small focused docs, with rules for keeping them current. `AGENTS.md` and `CLAUDE.md` point AI agents to them | People and AI agents read only what a task needs | [README.md](./README.md) |
| P2 | Stack: pnpm workspaces; Fastify, zod (with OpenAPI generated from it), Drizzle, pg-boss; Next.js for the website; Expo (React Native) for the app | One language and shared types; light to run; one codebase for iOS and Android | [architecture.md](./architecture.md#stack) |
| P3 | The process engine is a pure function in `shared/`, with the route as a YAML file per version | Easy to test and to change | [architecture.md](./architecture.md#the-process-engine) |
| P4 | The AI is a module inside the backend, using the Vercel AI SDK. No separate agent service or MCP server for now | Simplest design that works; can be split out later | [architecture.md](./architecture.md#ai-module) |
| P5 | AI tiers: `read`, `auto` (the user's own things), `confirm` (an action card the user confirms), `never`. Enforced by the backend | Clear, testable limits on what the AI may do | [workstation-and-ai.md](./workstation-and-ai.md#what-the-ai-may-do) |
| P6 | Go (creating a project) is a signed decision | It commits people and money | [workflow.md](./workflow.md#decisions-recorded-at-steps) |
| P7 | One permission module, tested by role; database row-level security later | Enough for made-up data, and simple | [roles-and-access.md](./roles-and-access.md#how-access-is-enforced) |
| P8 | Until there's an org chart, the reporting line comes from roles (Board → VP → R&D Head → R&D Lead → team) | Needed for assigning work, escalation and team measures | [roles-and-access.md](./roles-and-access.md#assigning-work-and-making-requests) |
| P9 | *Replaced by D15.* First templates cover stages 1 and 2; other steps use uploads until their templates exist | Start where every project starts | [documents-and-signing.md](./documents-and-signing.md#the-template-library) |
| P10 | Every step sign-off signs a generated step sign-off record | Every sign-off has something concrete to sign, even without a named document | [documents-and-signing.md](./documents-and-signing.md#step-sign-off-records) |
| P11 | *Replaced by D12.* Notifications in the app and by push first; email when accounts have emails; WhatsApp later | Matches what accounts can support now | [dashboard.md](./dashboard.md#notifications-and-work-messages) |
| P12 | *Replaced by D13.* AWS Mumbai; local and staging use made-up data; real data only after real sign-in | Data in India; no real data behind a placeholder sign-in | [architecture.md](./architecture.md#environments-and-hosting) |
| P13 | The AI searches with PostgreSQL full-text search; no vector embeddings yet | Simpler, and avoids decisions about where embeddings are processed | [architecture.md](./architecture.md#ai-module) |
| P14 | The to-do list is called "My tasks" (Madhav suggested "Docket"; open) | Plain and clear | [open-questions.md](./open-questions.md#business) |
| P15 | Content is need-to-know, by role and project team; budgets go in a separate annex | Protects sensitive content while status stays open | [roles-and-access.md](./roles-and-access.md#content-is-need-to-know) |
| P16 | When work is sent back, only the steps that depend on the reopened step are reset; the step-20 follow-up is never reset | Correct by default, with no manual choices | [workflow.md](./workflow.md#failure-and-rework) |
| P17 | Productivity is measured as the flow of work (on-time rate against the first due date, and so on), never activity | Fair and hard to game | [dashboard.md](./dashboard.md#measures) |
| P18 | Departments and roles are data (tables), not code. The first rows are R&D and the departments R&D works with; the Board and VP sit above departments | New departments are added without changing the core | [roles-and-access.md](./roles-and-access.md#roles) |
| P19 | The engine's tables are general. A **process run** is one run of any process's route, and an R&D project is R&D's record for its run. Steps, tasks, decisions and documents point at runs, not projects | Other departments reuse the engine and everything around it | [data-model.md](./data-model.md#conventions) |
| P20 | The backend is one service made of modules: platform modules shared by every department, and one module per department (R&D first). A lint rule stops modules reaching into each other's tables | Comfortably serves about 800 users; a module can become its own service later if needed | [architecture.md](./architecture.md#growing-to-all-of-jayon) |
| P21 | The chat is channel-neutral: the AI module returns text, citations and action cards, and each channel shows them in its own way. Signing never happens inside a chat channel | WhatsApp and the app become new channels, not rebuilds | [workstation-and-ai.md](./workstation-and-ai.md#channels) |
| P22 | All website text is kept in message files from the start, ready for translation; English first | About 800 employees, including the shop floor; adding this later means touching every screen | [architecture.md](./architecture.md#growing-to-all-of-jayon) |
| P23 | Templates live in COAL (the Word file in file storage, the details in the database), never in the code repository. Jayon's files kept on a developer's computer go in the git-ignored `private/` folder | Jayon's documents stay private, and templates change without a code release | [documents-and-signing.md](./documents-and-signing.md#where-templates-live) |
