# COAL

An AI-assisted platform for Jayon. It starts by running R&D, from the VP's product idea to the product launch, and is built to grow to the whole company. Each person gets a Dashboard of expandable widgets and a Workstation with an AI assistant: on the website first, with a WhatsApp chat and a mobile app later.

**Status:** planning. The code isn't set up yet.

## Start here

- **The plan:** [docs/README.md](docs/README.md). It has the overview, links to every detailed doc, and the rules for keeping the docs up to date.
- **AI coding agents:** read [AGENTS.md](AGENTS.md).

## Repository layout

| Folder | What it holds |
|---|---|
| `backend/` | The API, process engine, AI module and background workers |
| `web/` | The website |
| `app/` | The mobile app (iOS and Android), in a later phase |
| `shared/` | Code used by the backend and the clients: schemas and types, route definitions, widget definitions |
| `docs/` | The plan. Earlier plans are in `docs/archive/` |
| `private/` | Jayon's files on your computer, such as templates. Git-ignored: never committed |

Details: [docs/architecture.md § Repository layout](docs/architecture.md#repository-layout).
