# AGENTS.md

Instructions for AI coding agents working in this repository.

## What this is

COAL is an AI-assisted platform for Jayon, an orthopaedic implant maker. It starts with the R&D process and will grow to the whole company, about 800 employees. It has a separate backend, a website and shared TypeScript code; a WhatsApp chat and a mobile app come later. The plan is in `docs/`; the build follows [docs/roadmap.md § Build order](docs/roadmap.md#build-order).

## Start here

1. **Read [docs/README.md](docs/README.md) first.** It has the plan on one page, the principles, and a table of which docs to read for each kind of task.
2. **Read only the docs your task needs.** Each doc says at the top when to read it.
3. **Ignore `docs/archive/` unless you need history.** It holds the earlier plans; they are not the current plan.

## Rules

1. **Follow the principles** in [docs/README.md](docs/README.md#principles).
2. **Keep the docs true.** Update the affected docs in the same change as the code or decision, following [Keeping the docs up to date](docs/README.md#keeping-the-docs-up-to-date). Each fact has one home; link to it rather than copying it.
3. **Don't build on guesses.** Don't invent step-specific or regulatory tables, fields or rules. If information is missing, use a clearly marked assumption (⚠), add a question to [docs/open-questions.md](docs/open-questions.md), and tell the user.
4. **Made-up data only, and Jayon's files stay out of git.** Never put real Jayon data, documents or names into the code, tests or fixtures. Jayon's templates and documents live in the git-ignored `private/` folder or in COAL itself, never in a commit.
5. **The backend enforces the rules.** Every endpoint declares its permission and its AI tier, and gets allowed and denied tests for each role ([docs/api.md](docs/api.md#adding-an-endpoint)).
6. **Route changes go together.** A change to the R&D route updates the route definition and its tests in `shared/`, and [docs/workflow.md](docs/workflow.md).
7. **Keep the parts apart.**
   - `web/` and `app/` import only from `shared/`, and talk to `backend/` through the API.
   - `shared/` imports from no other part.
   - Anything two parts need goes in `shared/`.
   - In the backend, platform modules hold nothing specific to one department; R&D-specific code goes in the R&D module ([docs/architecture.md](docs/architecture.md#growing-to-all-of-jayon)).
8. **Record decisions.** If you make or are told a decision, add it to [docs/decisions.md](docs/decisions.md).

## Commands

Node 22 and pnpm 10 (see `.nvmrc` and `packageManager`). Docker runs the local services. Tests that make PDFs use a stand-in for Gotenberg; `test/gotenberg.test.ts` uses the real one when it is running.

| What | Command |
|---|---|
| Install | `pnpm install` |
| Start PostgreSQL, MinIO and Gotenberg | `pnpm db:up` (stop: `pnpm db:down`) |
| Settings | `cp .env.example .env` (defaults match `docker-compose.yml`) |
| Migrate and load reference data | `pnpm --filter @coal/backend db:migrate` |
| Load templates (drafts) from `private/templates/`, or COAL's made-up samples | `pnpm --filter @coal/backend templates:import` (`--samples`, or a folder) |
| Fill an empty development database with made-up people and three projects (some late), so the Dashboard has something to show | `pnpm --filter @coal/backend seed:demo` (start again with `docker compose down -v`, then `pnpm db:up` and migrate) |
| Virus scanner, optional locally | `docker compose --profile scan up -d`, then `CLAMAV_HOST=localhost` in `.env` |
| Run the API, worker and website | `pnpm dev` (API on :4000, website on :3000, API docs at `/api/v1/docs`) |
| Everything CI runs | `pnpm check` (lint, type checks, formatting, tests) |
| Lint | `pnpm lint` |
| Type check | `pnpm typecheck` |
| Format | `pnpm format` (check only: `pnpm format:check`) |
| Tests | `pnpm test` (needs `pnpm db:up`); one package: `pnpm --filter @coal/backend test` |
| The AI exam: the real model, about US$4 a run, so by hand: whenever the instructions, tools, tiers or model change, and before a release ([docs/ai-safety.md](docs/ai-safety.md#how-we-test-it)) | `pnpm eval:ai` (needs `pnpm db:up` and the AI set up in `.env`; `EVAL_ONLY=leak,trick` for some cases, `EVAL_REPEAT=3`, `EVAL_SAVE_BASELINE=1` after a good run) |
| New migration after changing a `tables.ts` | `pnpm --filter @coal/backend db:generate` |
| Write the OpenAPI spec to `backend/openapi.json` | `pnpm --filter @coal/backend openapi` |
| Build the website | `pnpm --filter @coal/web build` |
| Update the test deployment | Push to `main`: Railway rebuilds once CI passes ([docs/demo-hosting.md](docs/demo-hosting.md)) |

## Where things go

- **An endpoint:** its contract (schemas, permission, AI tier) in `shared/src/schemas/` and the list in `shared/src/api/endpoints.ts`; its rule in `backend/src/modules/permissions/rules.ts` and its row in `permissions.test.ts`; its handler in the module's `routes.ts`. Steps: [docs/api.md § Adding an endpoint](docs/api.md#adding-an-endpoint).
- **An AI tool:** a definition in `backend/src/modules/ai/tools.ts` that wraps one `read` or `auto` endpoint (a test fails for any other tier), with what the model sees and the records it can cite. **The AI's instructions:** the files in `backend/src/modules/ai/prompts/`; any change should be checked against the AI exam (`pnpm eval:ai`, [docs/ai-safety.md](docs/ai-safety.md#when-the-exam-is-run)). **The AI exam:** its questions in `backend/eval/cases.ts` (a leak, trick or injection case for every new way the AI can read or act), the made-up company and its planted secrets in `backend/eval/world.ts`, the checks in `backend/eval/checks.ts`, the release bar in `backend/eval/report.ts`; a new tool or card that reads or changes something gets a case. **How the AI is kept safe** (every measure, and the checklist for a new AI feature): [docs/ai-safety.md](docs/ai-safety.md); a change to a measure updates it. **A model provider:** an adapter in `backend/src/modules/ai/` behind the `AiProvider` interface; a new provider or model needs a run of the exam and its own baseline. **How a request is processed** (the checks, in order, and where each can stop): [docs/workstation-and-ai.md § How a reply is made](docs/workstation-and-ai.md#how-a-reply-is-made); a change to a check, a tier or the order updates that picture too. **Turning a sample into a template:** `backend/src/modules/templates/sample*.ts` (outline, editing, PDF) and the `read_sample` and `prepare_template` tools. **Drafting checks:** `shared/src/rules/drafting.ts`.
- **Research in public sources:** a kind of source is a schema in `shared/src/schemas/research.ts` and a connector in `backend/src/modules/research/connectors/` (its host goes on the allowed list in `client.ts`, and its tests use the stand-in `fetchOutside` with made-up fixtures, never the internet); the default places are in `research/catalogue.ts`; the rules on search words are in `shared/src/rules/research.ts`; the research assistant's instructions are in `backend/src/modules/ai/prompts/research.ts` ([docs/workstation-and-ai.md](docs/workstation-and-ai.md#researching-what-already-exists)).
- **An action the AI may put on an action card:** a `describe` option on the endpoint's `implement()` (only `auto` and `confirm` endpoints); proposals then run it through its own handler ([docs/api.md § Proposals](docs/api.md#proposals-and-action-cards)).
- **A route or its rules:** the YAML in `shared/src/process/` (a loaded version is never edited: add a new version file), its tests in `engine.test.ts`, and `docs/workflow.md`, together. The engine is pure (`shared/src/process/engine.ts`); what an action does to tasks, events and the audit trail is in `backend/src/modules/rnd/actions.ts`.
- **A document type or its sample template:** the type in `backend/src/modules/templates/catalogue.ts`, the sample in `samples.ts`; a real template is a Word file plus a specification (`shared/src/rules/templates.ts`) loaded with the import command ([docs/documents-and-signing.md § The template library](docs/documents-and-signing.md#the-template-library)).
- **Step effects on documents** (sign-off records, carrying documents forward, signed decisions): `backend/src/modules/documents/signoff.ts`, called from `backend/src/modules/rnd/actions.ts`. Who may read a document is one pure rule, `documentAccess` in `permissions/rules.ts`.
- **A table:** in the owning module's `tables.ts`, then `db:generate`. Changes go through `change()` in `backend/src/core/db/change.ts`, so the audit entry and events are written in the same transaction.
- **Website text:** in `web/messages/en.json`, never in a component. Lint fails on text written straight into JSX.
- **Lint rules that keep the parts apart:** `eslint-plugin-coal.mjs` (`coal/part-boundaries`, `coal/module-tables`).
