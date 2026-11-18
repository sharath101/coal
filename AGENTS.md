# AGENTS.md

Instructions for AI coding agents working in this repository.

## What this is

COAL is an AI-assisted platform for Jayon, an orthopaedic implant maker. It starts with the R&D process and will grow to the whole company, about 800 employees. It has a separate backend, a website and shared TypeScript code; a WhatsApp chat and a mobile app come later. The code isn't set up yet; the plan is in `docs/`.

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

None yet. When the code is set up, list the install, build, lint, type-check and test commands here.
