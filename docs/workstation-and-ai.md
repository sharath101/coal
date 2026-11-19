# Workstation and AI

**Read this when** you work on the Workstation page, the AI assistant, its tools, action cards, AI providers, or AI safety.
**Related:**
- [roles-and-access.md](./roles-and-access.md) — what the user may see
- [documents-and-signing.md](./documents-and-signing.md) — the template library and signing
- [api.md](./api.md#proposals-and-action-cards) — proposals
- [architecture.md](./architecture.md#ai-module) — where the AI runs

⚠ marks an assumption. See [open-questions.md](./open-questions.md#ai).

---

## The Workstation

The Workstation is each person's second page: a chat assistant like ChatGPT or Claude, organised by project. It's on the website first; the same chat comes to WhatsApp and the mobile app later ([channels](#channels)).

```
┌──────────────────┬──────────────────────────────────────┬───────────────────────┐
│ MY TASKS         │  SPN-26-004 · Step 1 · PID     ✕      │  PREVIEW              │
│  ● Draft the PID │                                      │  PID · draft 2        │
│    due 27 Nov    │  You: Draft the PID from the concept │  1. Purpose …         │
│  ○ Review survey │                                      │  2. Scope …           │
│                  │  COAL: Read the concept, the PID     │  3. Team: R. Menon …  │
│ PROJECTS         │  template and the team ▸ 3 sources   │                       │
│  ▸ SPN-26-004    │  The draft is in the preview. Two    │  Sources              │
│     Step 1 chat  │  gaps: target markets, budget range. │  • Concept (C)        │
│  ▸ TRM-26-002    │  ┌ ACTION ─────────────────────────┐ │  • Template PID r3    │
│ GENERAL CHATS    │  │ Ask Meera (Ops) for the market   │ │                       │
│  + New chat      │  │ size by Fri  [Confirm] [Edit]    │ │  [ Submit ]           │
│                  │  └──────────────────────────────────┘ │                       │
│                  │  [ Ask, or type / for commands ]  📎  │                       │
└──────────────────┴──────────────────────────────────────┴───────────────────────┘
```

- **Left: my tasks and projects.** My tasks sits at the top. Below it is a space for each project the person works on, holding its chats, then general chats. Any other project can be opened from the Dashboard or search.
- **Centre: the conversation.** Answers carry citations: hover to see the source passage, click to open it. A short activity line ("Looked at 3 documents and the route") shows what the AI consulted.
- **Right: the preview.** Whatever is being worked on: a document draft, a table, a project's route. Submit and Sign live here, so reviewing and signing happen in one place.
- **Context.** A chat can be pinned to a project, step, document or task. "Ask AI" on a Dashboard widget, and "Open in Workstation" on a task, open a chat with that context already attached.
- **Input.** @mentions for people, projects and documents; `/` for commands; files and photos.
- **On a narrow screen,** such as a phone's browser, the three panes become tabs.

## How the AI works in the first release

- **Only when asked.** The AI runs when a person sends a message or presses an AI button, such as "Draft it" on a task. Nothing runs in the background.
- **As the person.** Every AI request acts as the person asking, with the same permission checks ([roles-and-access.md](./roles-and-access.md#how-access-is-enforced)). The AI can never see more than the person could.
- **Through tools.** The AI reads and acts only through tools, and each tool calls the backend's own services. It has no direct database access.
- **Facts from records.** Numbers, dates, names and statuses come from tool results and are shown with a link to their source. Tables are drawn from the data, not retyped by the AI. If no record answers the question, the AI says it doesn't know, and suggests who might.

### The five things the AI does

| # | Feature | Examples | What it writes |
|---|---|---|---|
| 1 | **Answer questions** about projects, tasks, documents and status | "What's waiting on me?" · "Which Spine projects are late, and why?" · "What did the FEA report conclude?" · "When does my part start?" | Nothing |
| 2 | **Turn an idea into a project** (step C) | The VP describes an idea in their own words | A concept draft. Go needs the VP's signature ([below](#idea-to-project)) |
| 3 | **Draft a document** from its template | "Draft the PID from the concept" · "Draft the market study" | A draft the user owns ([below](#drafting-a-document)) |
| 4 | **Assign work and make requests** | "Ask Anil to rerun the FEA by Friday, and tell Priya to update the drawing" | Tasks or requests, after the user confirms ([below](#assigning-work)) |
| 5 | **Explain and check documents** | "What am I signing, and what changed?" · "Compare draft 2 with draft 3" · "Is anything missing from this Action Plan?" | Nothing |

Commands for these: `/ask`, `/idea`, `/draft`, `/assign`, `/brief` (what am I signing), `/status`.

## What the AI may do

Every backend endpoint declares what the AI may do with it: its **AI tier** ([api.md](./api.md#conventions)).

| Tier | The AI may | Examples |
|---|---|---|
| `read` | Use it freely, within what the user may see | Projects, route, tasks, documents, widgets, search |
| `auto` | Use it directly, for the user's own things only. It's logged and can be undone | Save a draft the user owns; create a task for the user themselves; add a note to the user's own draft |
| `confirm` | Only through an **action card** that the user confirms | Assign a task or send a request; reassign; submit a document or step; record a milestone or deviation; change the team; comment where others are notified; edit someone else's draft |
| `never` | Never. It can prepare the work and give a button that opens the right screen | Sign anything (including Go); decide at a checkpoint; send work back; hold or drop a project; send anything outside Jayon; delete anything |

**The server enforces this, not the AI's instructions.**

- **Marked calls.** Every AI tool call is marked "via AI" and carries the user's identity.
- **Refusals.** Endpoints at the `confirm` tier refuse marked calls, except to create a proposal. Endpoints at the `never` tier refuse them outright.
- **Signing.** Signing also needs Face ID or a fingerprint on the user's own device, which the AI can't provide.

### Action cards

When the AI wants to do something at the `confirm` tier, it creates a **proposal** on the server, shown as an action card. A proposal can bundle several actions, such as the VP's responsibility boxes.

1. **Preview.** The server previews the action without saving anything. It returns who gets what, the due dates, who is notified, and any warnings ("No DARD user yet, so this goes to the DARD queue").
2. **Show.** The card shows that preview in plain words, with Confirm, Edit and Cancel.
3. **Edit.** Changing an assignee, a date or the wording previews it again. The card always shows exactly what will happen.
4. **Confirm.** Only the user can confirm, from their own session; the AI can't. The server re-checks permissions and previews again. If the effect has changed, it shows the card again. Otherwise it carries out every action together, once.
5. **Record.** The audit trail records both the user and the AI chat that prepared it.

The same mechanism serves bulk actions in the normal screens, for example reassigning many tasks at once.

## The main flows

### Idea to project

1. **Describe.** The VP chooses **New idea** and describes it in their own words.
2. **Fill gaps.** The AI picks out what it needs: product, product line, where the idea came from (market or the VP's own requirement), the need, key requirements, target markets, any references, priority, and the desired launch. It asks only for what's missing and essential; the product line is required.
3. **Draft.** The AI drafts the **product concept** and shows it in the preview.
4. **Preview the project.** The AI asks the backend to preview creating the project. **The process engine, not the AI, decides what happens:** step C completes, steps 1, 2 and 2a open, and their tasks go to the people found by [the routing rules](./roles-and-access.md#who-gets-a-task).
5. **Show the boxes.** One box per person: their step and task, who they work with, who signs, the due date, and the work message they'll receive.
6. **Edit and Go.** The VP edits a box or the concept if needed, then presses **Go** and signs with Face ID or a fingerprint. The project is created, everyone gets their task and work message, and every project member gets a project space in their Workstation.

The same flow works without the AI: New idea is also a plain form.

### Drafting a document

1. **Start.** The user asks for a document, or presses "Draft it" on a task.
2. **Find the template.** Every time, the AI looks up the document type's **active template** in the [template library](./documents-and-signing.md#the-template-library). It never works from memory or an earlier chat, so a changed template applies at once. If there's no template, it says so; it can still write a plain draft, marked "no template".
3. **Gather.** The template's specification says which sections are **fields** and which are **written**. The AI gathers the inputs with tools: earlier documents, the team, dates. It asks the person for any field COAL doesn't hold.
4. **Write.** Fields are filled from records or from the person's answers, never by the AI. The AI writes only the written sections, each with citations.
5. **Check.** Every required section is present, every field has a value or is flagged as a gap, and no written section states a number that isn't in a source.
6. **Preview.** The draft opens in the preview, with gaps highlighted. The user edits by chatting ("make the scope narrower") or directly.
7. **Save.** Saving creates a new draft version owned by the user (`auto` tier). Submitting it for signatures goes through an action card. Signing is always the user's own act.
8. **Record.** Each draft records the template version, model, instructions and sources that produced it. AI-written sections are marked as such until a person edits or approves them.

**Until the template library exists** (block 3), drafting reads the step's folder in the git-ignored `private/templates/` (one folder per step, named by its number) fresh every time (P46). The drafting model reads the chosen file; a Word template is filled on its own file, so its letterhead, header and footer stay. **If the step has no template,** the model writes one in the same style as Jayon's other forms, on Jayon's letterhead (`private/templates/_letterhead.docx`), and says so. Gaps are written `[[to fill: …]]`, highlighted in the Word file and listed beside the preview.

**Which templates:** every step's documents, as their templates are added to the library, starting with stages 1 and 2. For steps whose data COAL doesn't hold yet, most fields come from the person. The AI can still help with any document as a chat.

### Assigning work

1. **Ask.** A manager writes, for example: "Ask Anil to rerun the FEA on the cage by Friday, and tell Priya to update the drawing to rev C."
2. **Resolve.** The AI identifies each person and links each item to the right project and step, asking if it's unclear.
3. **Assign or request.** Each item becomes an assignment, if the person is below the manager on the [ladder](./roles-and-access.md#assigning-work-and-making-requests), or a request otherwise.
4. **Confirm.** One action card shows both items: who, what, due date and the message. The manager confirms.
5. **Deliver.** The tasks show "Assigned by R&D Head via the Workstation", and the assignees are notified.

## Channels

The chat is built **channel-neutral**. A channel passes in a person's message; the AI module returns text, citations and action cards in a neutral form, and each channel shows them in its own way. The rules, tiers and permissions are the same in every channel.

| Channel | When | Notes |
|---|---|---|
| Website | First release | The Workstation described above |
| WhatsApp | After the first release | Action cards become WhatsApp buttons. A person's phone number is linked to their account. What may be shown in WhatsApp is agreed with Jayon first ([open-questions.md](./open-questions.md#ai)) |
| Mobile app | A later phase | The Workstation, as on the website |

**Signing and other `never`-tier actions don't happen in a chat channel.** In WhatsApp, the AI sends a link that opens the right screen on the website.

## AI providers

COAL works with both **Claude (Anthropic)** and **OpenAI**. Which one to use is decided later ⚠.

- **One gateway.** All AI calls go through one small gateway in the backend (`backend/src/modules/ai/gateway.ts`). It calls Claude through Anthropic's own SDK (P44); an OpenAI adapter can sit behind the same gateway when it's needed ⚠.
- **Configuration, not code.** Each kind of work has its own row in the **model table** below. `AI_MODEL_<ROW>=<model id>` in `.env` changes a row without a code release.
- **Both stay working** ⚠. Once the OpenAI adapter exists, the evaluation tests run against both providers, so either can be switched on at any time.
- **Data settings.** Chats are kept in COAL's own database, and storage is turned off at the provider where the API allows it. Provider APIs don't train on our data by default. Apply for zero data retention before real data is used.
- **Budgets.** Each person has a daily budget and each request has a limit. Every call's tokens and cost are logged.
- **Data rules.** Which data may be sent to which provider, and whether it must be processed in India, is decided before real data arrives ([open-questions.md](./open-questions.md#ai)). Until then COAL holds made-up data only.

### The model table

Cheap and fast where the work is simple, the strongest model where quality matters most (P43). The cheapest model reads every message first and picks the row; the person can also pick a row by hand in the Workstation, to compare models. The table lives in `backend/src/modules/ai/models.ts`, and the Workstation shows it with prices.

| Row | What it does | Model | Effort | Why |
|---|---|---|---|---|
| `route` | Reads each message and picks the row | Haiku 5.5 | low | Runs on every message; sorting a message into one of seven kinds is easy |
| `chat` | Small talk, help, how COAL works | Haiku 5.5 | low | Short answers with no records to weigh |
| `lookup` | My tasks, a project's status, who is on a team | Haiku 5.5 | medium | One or two tool calls; the facts come from records, not the model |
| `analysis` | Reasoning across records ("which Spine projects are late, and why?") | Sonnet 5.5 | medium | Several lookups and a judgment, at half the price of Opus |
| `idea` | Idea to project: the concept, then the Go preview | Sonnet 5.5 | medium | Pulling the details out of free text and asking for what's missing |
| `assign` | Assigning work and requests, as action cards | Sonnet 5.5 | medium | People, projects and steps must be resolved right |
| `draft` | Gathers what a document needs, then hands it to the writer | Sonnet 5.5 | medium | Finds the project, step and template |
| `draft_write` | Writes the document from the template or on the letterhead | Opus 5.5 | high | Signed, regulated documents: follow the form exactly, never invent a number |
| `template_pick` | Picks the template when a step has several | Haiku 5.5 | low | Choosing one file name from a short list |
| `explain` | Explains or checks a document before someone signs | Opus 5.5 | high | A missed gap gets signed |
| `deep` | Questions the router marks as complex | Opus 5.5 | high | Escalation for judgment Sonnet might get wrong |

Opus and Sonnet calls carry Anthropic's server-side fallback, so a safety decline is retried on a fallback model inside the same call. Saved thinking is tied to the tool list it was made with, and the tools grow with every new endpoint, so calls set `drop_block`: an older chat carries on without that thinking instead of failing. Keys that aren't scoped to one workspace (`sk-ant-usr-…`) need `ANTHROPIC_WORKSPACE_ID` as well. Every call's model, tokens, cost and time are logged, and shown under each reply.

## How the AI is told what to do

Each request builds the AI's instructions in layers:

1. **Platform rules:** safety, tools, citations, the tiers, and that it never claims to have signed or decided anything.
2. **Company:** the glossary and a summary of the R&D route.
3. **Role:** the steps this person's role does and signs, worked out from the route definition.
4. **User:** name, role, product line.
5. **Context:** the pinned project, step, document, task or widget.
6. **Retrieved data:** tool results and search passages, each marked with its source.

The instructions are versioned files in `backend/`. Any change runs the evaluation tests.

## Safety basics

- **Outside documents.** Lab reports, vendor PDFs and anything else from outside Jayon are marked "outside" when uploaded.
  - While outside text is in a chat, the AI can't save anything automatically. Every write becomes an action card, and it can't create requests or messages to others.
  - Links and images in AI answers aren't displayed.

  This limits what hidden instructions in a document can do.
- **No dangerous tools.** There is no tool to sign, decide, delete, or send anything outside Jayon. No instruction, however worded, can make the AI do these.
- **Refusals.** If the user may not see something, the AI says so plainly and names who can. It never hints at the content.
- **Drafts are drafts.** AI-written sections are marked until a person edits or approves them, and a person signs every document.

## Testing the AI

- **Known answers.** A set of questions with known answers for each role runs on every change to the instructions, tools or model, against both providers. A drop in accuracy blocks the release.
- **Permission tests.** Questions each role must **not** be able to answer, plus attempts to talk the AI out of its rules. Any leak blocks the release.
- **Measures in use:** how often action cards are confirmed, how much drafts change before approval, thumbs up or down, cost per person.

## Later

- **Runs that start on their own.** When a task opens, the AI starts the work with a live checklist from a **playbook** for each step, so the draft is waiting when the person arrives.
- **AI-written messages.** Work messages and a daily briefing, written by the AI.
- **A research assistant** that searches public sources (openFDA, PubMed, ClinicalTrials.gov, patents) with no access to Jayon's data.
- **Outside documents.** A reader with no tools that turns lab reports and certificates into fixed forms for a person to confirm.
- **Meetings.** Minutes for the review meeting (step 12), from recordings in English and Malayalam.
- **SolidWorks.** A connector on designers' own PCs (read and export first).
- **Search and data rules.** Vector search over documents, and routing each request by data sensitivity, for example keeping some data in India.
- **More checks.** A second model checking drafts of high-risk documents (labelling, submissions, FEA reports).
- **More channels:** WhatsApp, then the mobile app ([channels](#channels)).
- **Personal features.** Memory that a person can see and edit, and sharing chats.
