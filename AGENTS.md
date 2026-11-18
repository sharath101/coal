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

Node 22 and pnpm 10 (see `.nvmrc` and `packageManager`). Docker runs the local services.

| What | Command |
|---|---|
| Install | `pnpm install` |
| Start PostgreSQL, MinIO and Gotenberg | `pnpm db:up` (stop: `pnpm db:down`) |
| Settings | `cp .env.example .env` (defaults match `docker-compose.yml`) |
| Migrate and load reference data | `pnpm --filter @coal/backend db:migrate` |
| Run the API, worker and website | `pnpm dev` (API on :4000, website on :3000, API docs at `/api/v1/docs`) |
| Everything CI runs | `pnpm check` (lint, type checks, formatting, tests) |
| Lint | `pnpm lint` |
| Type check | `pnpm typecheck` |
| Format | `pnpm format` (check only: `pnpm format:check`) |
| Tests | `pnpm test` (needs `pnpm db:up`); one package: `pnpm --filter @coal/backend test` |
| New migration after changing a `tables.ts` | `pnpm --filter @coal/backend db:generate` |
| Write the OpenAPI spec to `backend/openapi.json` | `pnpm --filter @coal/backend openapi` |
| Build the website | `pnpm --filter @coal/web build` |

## Where things go

- **An endpoint:** its contract (schemas, permission, AI tier) in `shared/src/schemas/` and the list in `shared/src/api/endpoints.ts`; its rule in `backend/src/modules/permissions/rules.ts` and its row in `permissions.test.ts`; its handler in the module's `routes.ts`. Steps: [docs/api.md § Adding an endpoint](docs/api.md#adding-an-endpoint).
- **A route or its rules:** the YAML in `shared/src/process/` (a loaded version is never edited: add a new version file), its tests in `engine.test.ts`, and `docs/workflow.md`, together. The engine is pure (`shared/src/process/engine.ts`); what an action does to tasks, events and the audit trail is in `backend/src/modules/rnd/actions.ts`.
- **A table:** in the owning module's `tables.ts`, then `db:generate`. Changes go through `change()` in `backend/src/core/db/change.ts`, so the audit entry and events are written in the same transaction.
- **Website text:** in `web/messages/en.json`, never in a component. Lint fails on text written straight into JSX.
- **Lint rules that keep the parts apart:** `eslint-plugin-coal.mjs` (`coal/part-boundaries`, `coal/module-tables`).
