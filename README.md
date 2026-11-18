# COAL

An AI-assisted platform for Jayon. It starts by running R&D, from the VP's product idea to the product launch, and is built to grow to the whole company. Each person gets a Dashboard of expandable widgets and a Workstation with an AI assistant: on the website first, with a WhatsApp chat and a mobile app later.

**Status:** building. Block 1 of the build order, Foundations, is done: the monorepo, accounts, permissions, the audit trail, file storage and the website skeleton ([docs/roadmap.md](docs/roadmap.md#build-order)).

## Start here

- **The plan:** [docs/README.md](docs/README.md). It has the overview, links to every detailed doc, and the rules for keeping the docs up to date.
- **AI coding agents:** read [AGENTS.md](AGENTS.md).
- **Run it locally:** `pnpm install`, `pnpm db:up`, `cp .env.example .env`, `pnpm --filter @coal/backend db:migrate`, then `pnpm dev` and open http://localhost:3000. All commands are in [AGENTS.md § Commands](AGENTS.md#commands).

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
