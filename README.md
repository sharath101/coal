# COAL

An AI-assisted platform for Jayon. It starts by running R&D, from the VP's product idea to the product launch, and is built to grow to the whole company. Each person gets a Dashboard of expandable widgets and a Workstation with an AI assistant: on the website first, with a WhatsApp chat and a mobile app later.

**Status:** building. Blocks 1 to 4 of the build order are done: the foundations (monorepo, accounts, permissions, the audit trail, file storage, the website skeleton), the route (the 28 steps, the engine, projects, tasks, sign-offs, sending work back, hold and drop, and their pages), documents and signing (the template library with sample templates, documents with versions and PDFs, signature rows, step sign-off records, attachments, virus scanning), and the Dashboard (dates, the forecast and health, deviations, notifications and live updates, widgets W1 to W10, the project page's Timeline). The Workstation and AI (block 5) is built except its safety and test sets (5e): requests and action cards, search, the AI chat that cites its sources, the Workstation page, turning a sample document into a template, drafting documents from templates, turning an idea into a project to review and Go, and explaining and comparing documents. Passkey signing is last ([docs/roadmap.md](docs/roadmap.md#build-order)).

## Start here

- **The plan:** [docs/README.md](docs/README.md). It has the overview, links to every detailed doc, and the rules for keeping the docs up to date.
- **AI coding agents:** read [AGENTS.md](AGENTS.md).
- **Run it locally:** `pnpm install`, `pnpm db:up`, `cp .env.example .env`, `pnpm --filter @coal/backend db:migrate`, then `pnpm dev` and open http://localhost:3000. The VP and the R&D Head can add templates on the Templates page; sample templates and a few made-up holidays are loaded when the backend starts. For a Dashboard with something on it, run `pnpm --filter @coal/backend seed:demo` once on an empty database. All commands are in [AGENTS.md § Commands](AGENTS.md#commands).

## Repository layout

| Folder | What it holds |
|---|---|
| `backend/` | The API, process engine, AI module and background workers |
| `web/` | The website |
| `app/` | The mobile app (iOS and Android), in a later phase |
| `shared/` | Code used by the backend and the clients: endpoint contracts, schemas and types, the typed API client, route definitions, widget definitions |
| `docs/` | The plan. Earlier plans are in `docs/archive/` |
| `private/` | Jayon's files on your computer, such as templates. Git-ignored: never committed |

Details: [docs/architecture.md § Repository layout](docs/architecture.md#repository-layout).
