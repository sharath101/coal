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

- **Left: my tasks and projects.** My tasks sits at the top; each opens a new chat about that task. Below it is a space for each project, holding its chats (a "+" starts a new one about that project), then general chats. Any other project can be opened from the Dashboard or search.
- **Centre: the conversation.** Answers carry citations: small numbered marks that show the record and its passage on hover and open it on click, numbered in the order the answer uses them. A line under the answer shows what the AI consulted ("Looked at 3 things", opening to the list), and while it works each lookup appears as it happens. Action cards sit in the conversation with Confirm, Edit and Cancel. Each answer has thumbs up and down, and a Stop button replaces Send while it is being written.
- **Right: sources and preview.** The records the selected answer rests on, with the passage each gave and a link to open it, and what the AI looked at. Document drafts and the Submit and Sign buttons come here with drafting, so reviewing and signing happen in one place ([roadmap.md](./roadmap.md#build-order)).
- **Context.** A chat can be pinned to a project, step, document or task, and shows what it is about. The address says what a new chat is about (`/workstation?project=&step=&document=&task=&widget=`), so "Ask AI" on a Dashboard widget, a project, a step and a document, and "Open in Workstation" on a task, are plain links.
- **Input.** `/` lists commands (`/status`, `/assign`, `/brief`: each starts a message you finish, or for `/brief` sends at once; `/idea` and `/draft` come with drafting). `@` finds people, projects and documents. Enter sends and Shift+Enter starts a new line. Files and photos come with outside documents ([safety](#safety-basics)).
- **Editing a card.** A card of tasks can be edited on screen (what, who, when), which checks it again as a new version. Any other card is changed by asking the assistant ("make it Monday"), which knows which cards are waiting.
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

Commands for these: `/status`, `/assign`, `/brief` (what am I signing) now; `/idea` and `/draft` with drafting. Asking a question needs no command.

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
- **Signing.** Signing is a person's own act: a confirmed click for now, and Face ID or a fingerprint on the user's own device once passkeys arrive. The AI can't do either, and the sign endpoints are closed to it (tier `never`).

### Action cards

When the AI wants to do something at the `confirm` tier, it creates a **proposal** on the server, shown as an action card. A proposal can bundle several actions, such as the VP's responsibility boxes. Each action is a call to an existing endpoint, run as the user; how proposals work is in [api.md](./api.md#proposals-and-action-cards).

1. **Preview.** The server previews the action without saving anything. It returns who gets what, the due dates, who is notified, and any warnings ("No DARD user yet, so this goes to the DARD queue").
2. **Show.** The card shows that preview in plain words, with Confirm, Edit and Cancel.
3. **Edit.** Changing an assignee, a date or the wording previews it again. The card always shows exactly what will happen.
4. **Confirm.** Only the user can confirm, from their own session; the AI can't. The server re-checks permissions and previews again. If the effect has changed, it shows the card again. Otherwise it carries out every action together, once.
5. **Record.** The audit trail records both the user and the AI chat that prepared it.

The same mechanism serves bulk actions in the normal screens, for example reassigning many tasks at once.

## How a reply is made

1. **The message.** The person sends it in a chat. A chat is private to them, whatever their role, and can be pinned to a project, step, document, task or widget. One reply is written at a time per chat, and the person can stop it ([api.md](./api.md#ai)).
2. **The budget.** If the person has used today's budget (US$5, Indian time, [D18](./decisions.md)), the message is refused with `AI_BUDGET_REACHED` and nothing is sent to a model.
3. **The instructions** are built in layers ([below](#how-the-ai-is-told-what-to-do)).
4. **The model and its tools.** The gateway hands the instructions, the earlier messages and the tools to the provider, which runs the loop: the model asks for a lookup, COAL runs it, the model reads the answer and continues. At most `AI_MAX_TOOL_CALLS` (20) lookups per reply; after that the model is told to answer with what it has.
5. **The words stream back** to the website as they are written, with a line for each lookup ("Looked at your tasks") as it happens.
6. **The reply is saved** with its citations, the action cards it prepared, and a record of what it cost and what it looked at ([logged](#what-is-logged)). A new chat gets a short title from the cheaper model.

### The tools

Each tool is a thin wrapper over one endpoint, takes that endpoint's AI tier, and runs **as the person**, marked "via AI". The endpoint's own checks decide what comes back, so the AI never sees more than the person could. A refusal goes back to the model as text, including who can help, so it can say so plainly.

| Tool | Endpoint | Tier | For |
|---|---|---|---|
| `search` | `GET /search` | read | Finding a project, document, task or person without an id |
| `my_tasks` | `GET /tasks` | read | What is assigned to the person, waiting in their queue, or given by them |
| `list_projects`, `get_project`, `get_route`, `get_timeline` | projects, route and timeline | read | Where a project is, what comes next, its dates and delays |
| `list_deviations` | `GET /deviations` | read | Why work is late |
| `list_documents`, `read_document`, `compare_versions` | documents | read | What a document says, and what changed |
| `active_template` | `GET /templates/active` | read | The template in use for a document type (asked for every time) |
| `find_person` | `GET /users` | read | Who someone is, and their role |
| `waiting_signatures` | `GET /signature-requests` | read | What waits for the person's signature |
| `get_widget` | `GET /widgets/{key}` | read | A Dashboard widget's numbers and rows |
| `create_my_task` | `POST /tasks` | auto | A task on the person's **own** list. For anyone else, the server refuses a "via AI" call |
| `propose`, `revise_card` | `POST /proposals`, `PATCH /proposals/{id}` | auto | Preparing or changing an action card. The card lists what it may carry: the endpoints that can go on a card ([api.md](./api.md#proposals-and-action-cards)) |

Nothing that signs, decides, sends back, holds, drops, deletes or sends outside Jayon has a tool, and `confirm` and `reject` for cards are tier `never`. A test fails if a tool is built on an endpoint of any other tier, or if the card catalogue offers a `never` endpoint.

### Citations

Every tool result gives the records it read a tag (`[S1]`, `[S2]`…). The AI is told to cite a fact with the tag of the record it came from. When the reply is saved, tags that match a record read in this reply become **citations** (the record's type, label and link, and the passage when search found one), and a tag the AI made up is removed. The website shows a citation as a link that opens the record. This is how "facts come from records" is checked, not just asked for.

### What is logged

- **`ai_requests`** (insert-only): for each reply, the provider, model, prompt version, model calls, tool calls, tokens, cost, outcome (completed, stopped, error) and time. The title is a separate row with purpose `title`. The cost is worked out from the tokens at starting prices ⚠ ([AI11](./open-questions.md#ai)): it sets the budget and is never a bill.
- **`ai_tool_calls`** (insert-only): each tool the AI used, the endpoint and tier, whether it was allowed (and why not), what it asked for (cut short), and the records it got back.
- **Writes** are in the audit trail as usual: a task the AI made for the person is "user via AI", and a card prepared in a chat records that chat.
- Logs never carry the person's words or the AI's answers; those are in the chat itself, which only its owner can read.

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

COAL uses **Claude (Anthropic)** ([D17](./decisions.md)). OpenAI isn't integrated; another provider could be added behind the same interface.

- **One gateway.** All AI calls go through one small gateway in the backend, which hides the provider behind one interface: "run a turn with these instructions and these tools, and stream the answer back".
- **Configuration, not code.** Switching the model is a configuration change. Each purpose can have its own model:
  - chat and drafting use a strong model;
  - short tasks, such as titles, classification and extraction, use a cheaper one.
- **Two adapters, one interface.** A provider takes a turn (instructions, earlier messages, tools) and streams words back; tools, limits, logging and costs are COAL's own and are the same for every provider. The Anthropic adapter uses the Vercel AI SDK and names the workspace its key bills to on every call. The scripted stand-in plays a fixed script of words and tool calls, so the automatic tests need no key.
- **For now, Copilot on one laptop.** While the company laptop's network blocks the Anthropic API, Sharath's local development runs the AI through the GitHub Copilot SDK on his own Copilot licence (`AI_PROVIDER=copilot`, [D19](./decisions.md)). It is a stand-in for his own local work only: never for demos with other people, never with Jayon's data, and the backend refuses to start with it in production. It is a development-only dependency. COAL offers it only its own tools (`custom:*`: none of its built-in shell, file or web tools) and refuses every permission request it makes. Every request uses his Copilot allowance. When it ends, the AI test sets run again on Anthropic.
- **Data settings.** Chats are kept in COAL's own database, and storage is turned off at the provider where the API allows it. Provider APIs don't train on our data by default. Apply for zero data retention before real data is used.
- **Budgets.** Each person has a daily budget of US$5 ([D18](./decisions.md), `AI_DAILY_BUDGET_USD`) and each request has a limit. Every call's tokens and cost are logged.
- **Data rules.** Which data may be sent to which provider, and whether it must be processed in India, is decided before real data arrives ([open-questions.md](./open-questions.md#ai)). Until then COAL holds made-up data only.

## How the AI is told what to do

Each request builds the AI's instructions in layers (`backend/src/modules/ai/prompts/`):

1. **Platform rules** (`platform.ts`): safety, tools, citations, the tiers, plain text, one card for one request, and that it never claims to have signed or decided anything.
2. **Company** (`company.ts`): a short description of Jayon and COAL, the glossary's abbreviations, and **every step of the route** (key, name, stage, who does it, who signs), read from the route definition so it can't go out of date.
3. **Role** (`role.ts`): the steps this person's role does and signs, worked out from the route.
4. **User:** name, role, product line, and today's date in Indian time.
5. **Context:** the pinned project, step, document, task or widget, with ids so the AI need not search; and the action cards of this chat that still wait, with their ids, so "make it Monday" can change the right one.
6. **Retrieved data:** tool results, each with source tags.

The first three layers are files in the repository. Every request logs a **prompt version** (`v1-` and a fingerprint of the fixed text), which changes whenever the words do, so a change in behaviour can be traced to a change in the instructions. Any change should be checked against the AI test sets ([below](#testing-the-ai)).

## Safety basics

- **Outside documents.** Lab reports, vendor PDFs and anything else from outside Jayon are marked "outside" when uploaded.
  - While outside text is in a chat, the AI can't save anything automatically. Every write becomes an action card, and it can't create requests or messages to others.
  - Links and images in AI answers aren't displayed. (The AI is told not to write them; the chat screen shows only text, citations and cards, and comes in the next part.)

  This limits what hidden instructions in a document can do.
- **No dangerous tools.** There is no tool to sign, decide, delete, or send anything outside Jayon. No instruction, however worded, can make the AI do these.
- **Refusals.** If the user may not see something, the AI says so plainly and names who can. It never hints at the content.
- **Drafts are drafts.** AI-written sections are marked until a person edits or approves them, and a person signs every document.

## Testing the AI

- **Known answers.** A set of questions with known answers for each role runs on every change to the instructions, tools or model (`pnpm eval:ai`, by hand: it needs a key and costs money, so it isn't part of CI). A drop in accuracy blocks the release. The automatic tests use a scripted stand-in for the model instead: they check what the AI is shown, which tools it can reach (none of a closed tier), that every refusal reaches it as text, citations, budgets, stopping, failing and the logs.
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
