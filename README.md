# COAL

An AI-assisted platform that runs Jayon's R&D, from the VP's product idea to the product launch. Each person gets a Dashboard of expandable widgets and a Workstation with an AI assistant, on the website and in the mobile app.

**Status:** planning. The code isn't set up yet.

## Start here

- **The plan:** [docs/README.md](docs/README.md). It has the overview, links to every detailed doc, and the rules for keeping the docs up to date.
- **AI coding agents:** read [AGENTS.md](AGENTS.md).

## Repository layout

| Folder | What it holds |
|---|---|
| `backend/` | The API, process engine, AI module and background workers |
| `web/` | The website |
| `app/` | The mobile app (iOS and Android) |
| `shared/` | Code used by all three: schemas and types, the R&D route definition, widget definitions |
| `docs/` | The plan. Earlier plans are in `docs/archive/` |

Details: [docs/architecture.md § Repository layout](docs/architecture.md#repository-layout).
