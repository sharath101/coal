# Dashboard

**Read this when** you work on the Dashboard, widgets, measures, health, deadlines, alerts, deviations or notifications.
**Related:** [roles-and-access.md](./roles-and-access.md) for what each person may see, [api.md](./api.md#dashboard-and-notifications) for the widget endpoints, [workstation-and-ai.md](./workstation-and-ai.md) for "Ask AI".

---

## What the Dashboard is for

The Dashboard is one of each person's two pages; the Workstation is the other. A toggle in the top bar switches between them. The website comes first; the mobile app comes later.

The Dashboard answers three questions, in this order:

1. **What needs me now?** Tasks and signatures waiting for me.
2. **What's coming?** Work that will open soon, and upcoming checkpoints.
3. **How are we doing?** My projects, delays, and measures for me and the people below me.

Every number comes from the database, never from the AI. Every widget only counts what the viewer may see.

**Where it stands.** The widgets, the project page's dates and health, deviations, reminders, notifications and the live stream are built (block 4). The Dashboard also keeps the **Templates** link for the VP and the R&D Head, who manage the template library ([documents-and-signing.md](./documents-and-signing.md#adding-a-template)). "Ask AI" on each widget is shown but waits for the Workstation (block 5).

## Widgets

The Dashboard is a grid of **widgets**.

- **Compact card.** Each widget starts as a card with counts and the top few items.
- **Expanded view.** Clicking the card opens it into a full view with tabs, filters, a table or chart, and actions.
  - *On the web* it opens as a large panel over the Dashboard, so the grid doesn't jump.
  - *On a phone* it opens full screen.
  - Each expanded view has its own link (for example `/dashboard?w=my-tasks&tab=done`). Back or Esc closes it.
- **Drill-down.** Rows open the project page, the step, the document or the task.
- **Ask AI.** Every widget has an Ask AI button that opens the Workstation with that widget's data as context ([workstation-and-ai.md](./workstation-and-ai.md)).
- **Live.** When something relevant changes, the widget refreshes itself ([architecture.md](./architecture.md#events-and-live-updates)).
- **Layouts.** Each role has a default layout (below). Personal layouts come later.

**Every widget is defined in `shared/`** (`widgets/definitions.ts`), so the website, and later the mobile app, render the same thing. Each department's module adds its own widgets the same way:

```ts
interface WidgetDefinition {
  key: WidgetKey;                  // 'my-tasks'
  no: string;                      // 'W1'
  title: string;
  question: 'needs_me' | 'coming' | 'how';
  availableTo?: string[];          // roles that may use it; absent: everyone
  tabs: string[];                  // 'todo', 'in_progress', …
  filters: string[];               // 'project', 'step', 'kind', 'due', …
  columns: string[];               // the expanded table's columns, as keys of each row's cells
  actions: WidgetAction[];         // what a row may offer: start, done, more_time, sign, …
  refreshOn: string[];             // events that make it refresh
}
```

**One shape for every widget.** `GET /widgets/{key}` returns `counts` (the headline numbers, each with a tone), `rows` and `tabs`. A row has a title, a subtitle, a link, a tone, badges, `cells` (the values of the columns) and the `actions` this person may take, plus references (task, request, project, step) for those actions. The top few rows fill the compact card; the whole tab fills the expanded view. A client needs no widget-specific code to show a new widget, only labels for its columns.

## First-release widgets

| # | Widget | Answers | Compact card | Expanded view |
|---|---|---|---|---|
| W1 | **My tasks** | Needs me now | Overdue, due this week, in progress; the 5 most urgent | Tabs: To do, In progress, Waiting, Done. Filters: project, step, kind, due date. Actions: start, mark done, comment, ask for more time, open in the Workstation |
| W2 | **Waiting for my signature** | Needs me now | How many, the oldest in days, the next 3 | Each document or sign-off with its row (Prepared, Reviewed, Approved), what changed since the last version, and Sign or Return |
| W3 | **Coming up** | What's coming | My tasks that will open soon, with expected start dates | Every future task of mine across projects, and what it waits for ("Your part starts after step 5, expected 3 Feb") |
| W4 | **Upcoming checkpoints** | What's coming | The next checkpoints (4, 12, 18, 23) with dates | For each one: whether its inputs are ready and signed, and who signs |
| W5 | **My projects** | How are we doing | A card per project: a strip of the 6 stages, health, next due date | The project list; each opens the project page |
| W6 | **R&D pipeline** | How are we doing | Projects by stage and product line, and their health | Every project: line, stage, current steps, owner, days in stage, health, forecast launch |
| W7 | **Delays and risks** | How are we doing | Overdue steps, at-risk steps, the 3 worst slips | Each delay: project, step, owner, planned and forecast dates, days late, reason and category. The named cause only for those allowed to see it. A deviations tab |
| W8 | **Team workload** | How are we doing | Open and overdue tasks for each person below me | Person by week; reassign (where allowed) |
| W9 | **How it's going** | How are we doing | My on-time rate, and my team's | The measures below, for me and for each person below me |
| W10 | **Messages and activity** | Needs me now | My latest 5 work messages and notifications | The full feed, filters, mark as read |

### What each widget counts, as built

- **W1** my assigned tasks (signatures are on W2). "This week" runs to the coming Sunday. Tabs: To do, In progress, Waiting (the step is with its signer: not late, [P69](./decisions.md)), Done (the last 50). Filters: project, step, kind, due (overdue, this week, later, none). A late task can't be marked done until its deviation is recorded.
- **W2** the document rows waiting for me, and the step sign-offs assigned to me, oldest first.
- **W3** the steps of mine that are still locked, in projects I'm on (or lead): the step's doers include my role, or "the project team" and I'm on it. "Waits for" names the unfinished steps it depends on, with the expected date.
- **W4** the next unfinished checkpoint of each running project, with whether its inputs are finished, and who signs. Open to everyone: it is status.
- **W5** the projects I'm on, or lead. **W6** every project, with its stage, the steps open now, the Lead, days in stage, health and forecast launch; filters: product line, stage, health. Both are status, so open to everyone.
- **W7** every running project's overdue and at-risk steps, with the owner (the people holding the step's work tasks), the planned and forecast dates, days late, and the reason and cause of the latest deviation. The cause shows by name only to those allowed; the sentence of explanation appears on the Deviations tab only for people in the project's scope ([roles-and-access.md](./roles-and-access.md#content-is-need-to-know)).
- **W8** (VP, R&D Head, R&D Lead only) the open tasks of each person below me, by when they fall due. A Lead's people are those on their product line's projects.
- **W9** my measures, then each person below me. The Board sees department totals, not people.
- **W10** my notifications, newest first.

### Default layouts

| Role | Widgets, in order |
|---|---|
| Board | W2, W6, W7, W4, W9 (department totals) |
| VP | W2, W1, W6, W7, W4, W8, W9, W10 |
| R&D Head | W2, W1, W7, W6, W4, W8, W9, W10 |
| R&D Lead | W1, W2, W5, W7, W4, W8, W3, W9, W10 |
| Design engineer, AEMS, PME, R&D Ops, DARD, QC inspector | W1, W2, W3, W5, W10, W9 |
| Company QA, Quality Control, Production, Marketing | W1, W2, W10 |

Since everyone can see every project's status, anyone can add W6 (pipeline) to their own view once personal layouts exist.

### The project page

Opened from any widget row. It shows:

- **Header:** code, name, product line, stage, health, forecast launch, Lead.
- **The route:** all 28 steps in their stages, live: locked, ready, in progress, in review, returned, approved, not required. Overdue steps get a red ring, and reopened steps show their iteration ("×2").
- **Steps:** each step shows its doers and signer by name, tasks, documents and their signature status, dates, decisions, comments, pictures, sources and earlier iterations.
- **Other tabs:** Documents, Timeline (planned against forecast, with deviations), Team, Activity.

Content inside the page follows the access rules ([roles-and-access.md](./roles-and-access.md#what-people-can-see)). Someone who may only see status sees the route, dates and owners, but not the documents.

## Measures

They measure the flow of work, not activity: no keystrokes, no screen time. Each person sees their own. Managers see the people below them ([roles-and-access.md](./roles-and-access.md#assigning-work-and-making-requests)), with the reasons for any delay attached. A late task caused by a vendor shows that cause, and the person named can comment.

| Measure | Definition | Where it shows |
|---|---|---|
| On-time rate | Finished tasks done by their **first** due date ÷ finished tasks, over the last 90 days. A task counts as done when the doers handed the step in, not when the signer signed. Moving a date doesn't improve it. Signatures are measured below, not here | W9 |
| Days per task against plan | Working days from when a task opens to when it's done, and the days planned (to its first due date), on average | W9 |
| Sign-off turnaround | Working days from a signature request to the signature, on average | W9 |
| Rework rate | Share of this person's submitted document versions that were returned. *Work sent back by a step reset isn't counted yet* | W9 |
| Open load | Open tasks now, and how many are overdue | W8, W9 |
| Overdue steps | Project steps past their planned end and not yet approved | W7, project page |
| Schedule slip | Forecast launch minus planned launch, in days, per project | Project page, W6 |
| Days per stage | Days since the stage's first step opened. *Against plan, and per stage, comes with the history snapshots* | W6 |

They are calculated live from tasks, signatures and deviations, so they work from day one. Trend charts need daily snapshots, which come later.

### Health

Health uses dates only.

- **Step:**
  - *overdue:* past its planned end and not approved;
  - *at risk:* any of these is true:
    - its forecast end is after its planned end;
    - it's due within 2 working days and not started;
    - a signature on it has waited more than 3 working days.
- **Project:**
  - **red** if a checkpoint is overdue, the forecast launch has slipped more than 30 days, or a step is more than 10 working days overdue;
  - **amber** if any step is at risk or overdue;
  - **green** otherwise.

All thresholds are settings.

## Deadlines, alerts and deviations

**Where dates come from**

1. **Before the Action Plan.** Each step uses the default duration in the route definition (`default_days`, placeholders until W14 is answered), counted in working days from when it opens. A task is due on that date. A signature is due 3 working days after it is asked for.
2. **The baseline.** While step 5 is open, its doers (the Lead and the Head) write each role's planned start and end for the remaining steps as structured dates (`PUT /projects/{id}/timeline/plan`, on the project page's Timeline). The VP's sign-off at step 5 turns them into the **baseline**, which becomes everyone's due dates and the planned launch. If step 5 is submitted with no dates, the preview warns and the default lengths stay.
3. **Changes.** After the baseline, the Head changes a date with a reason; only the VP changes the launch step (25). Each change is a new row beside the baseline, which is kept, because the on-time rate is measured against first due dates. The Lead proposes a change by recording a deviation with a new date, which moves the forecast ([W13](./open-questions.md#workflow)).
4. **The forecast.** An open step's expected end is its start plus its length, moved later by a doer's new date from a deviation, and never into the past. Once the work is handed in, the step isn't finished until it is signed, so its expected end is the latest of today, the doer's new date and the signer's window after the hand-in (3 working days): it can be a day or two later than the deviation's new date, and that is not a disagreement. A waiting step starts when its inputs are expected to end. The project's forecast launch is the expected end of step 25. It's recalculated on every action, change and deviation, and every night at 00:10.

**The working calendar.** Monday to Friday, except the holidays and worked Saturdays in `work_calendar` (Jayon's calendar, [W22](./open-questions.md#workflow); a few made-up holidays until it arrives). Dates are calendar days in Indian time.

**Reminders and escalation.** These timings are settings (`settings`, key `schedule`; defaults in `shared/`), not code. They run each working day at 08:30 Indian time, once per person.

| When | What happens |
|---|---|
| 2 working days before the due date | A reminder to the assignee |
| On the due date | A reminder to the assignee and to the step's signer. The task turns red. The assignee is asked for a new expected date and the reason |
| 2 working days late | Tell the next role up the ladder ([roles-and-access.md](./roles-and-access.md#assigning-work-and-making-requests)) |
| 5 working days late | The task joins the exception list: one notification to the R&D Head and the VP, and a row in the Delays widget ([W24](./open-questions.md#workflow)) |
| A signature waiting | Reminders when due and every 2 working days after. An overdue VP or Board signature isn't escalated above them; the people who asked for it (those still holding the step's tasks) are told instead |

Reminders aren't sent for a project on hold, or for a task nobody holds yet (one waiting in a queue).

**Deviations.** When a task will be late, or is, the assignee (or the Lead of the line, or the Head) records, from the task:

- **the reason**, picked from: waiting for another step, vendor delay, test lab delay, rework, person unavailable, scope change, other. Plus a sentence of explanation.
- **the cause:** a person, a role or department, or an outside party (vendor, lab, surgeon).
- **the new expected date.**

The new date becomes the task's due date (its *first* due date stays) and, while that work is open, holds the step's forecast. **A late step can't be submitted, and a late task of the route can't be closed, until a deviation explains the miss** (`DEVIATION_REQUIRED`): for a step, a person's new date that hasn't passed yet; for a task, a deviation made for the due date it missed. Work given by hand (own tasks, assignments and requests) isn't on the plan, so it needs none ⚠ ([W25](./open-questions.md#workflow)). When the new date is missed too, the doer says why again. The project page and My tasks offer the form at that moment. The next role up the ladder, or anyone above in the project's scope (never the person who recorded it), confirms or corrects it: a correction is a new record pointing at the old one. The person or role named as the cause can add a comment. Who sees the named cause is in [roles-and-access.md](./roles-and-access.md#content-is-need-to-know).

## Notifications and work messages

| Event | Who is told |
|---|---|
| A task is made for me; my part of a step opens | The assignee, or everyone who can claim it from a queue, with a work message |
| A task is claimed or given to me by someone else | Me |
| A signature is requested | The signer |
| Work is returned for rework | The people still holding the step's tasks |
| Reminders and escalations | As in the table above |
| A checkpoint is decided; a project is put on hold, resumed or dropped | The project team |
| A deviation is recorded | The next role up, to confirm it; and the person named as the cause |
| I'm mentioned in a comment | Me *(later, with comments on steps)* |

- **Channels:** in-app on the website for now (the bell, and the Messages widget). Email follows once accounts have email addresses. WhatsApp alerts come later, and push notifications come with the mobile app.
- **Work messages** are written from templates in the route definition (`messages` in the route file). For example: *"Your part on SPN-26-004: step 1, Project inception, with the Spine Lead. The VP signs. Due 27 Nov. Input: Product concept."* A message never carries a comment, a reason or a document's content.
- **Live.** Open pages hear hints over the live stream and fetch what changed ([architecture.md](./architecture.md#events-and-live-updates)).
- **Privacy.** Messages sent outside COAL (email, and later WhatsApp and push) show no project details, for example "You have 1 new task in COAL". Opening COAL shows the details.

## Later

- **Widgets for the step modules** as they're built: budget and cost, procurement and outsourcing, design and FEA, prototypes and QC queue, machines and OEE, testing, regulatory readiness, market feedback, clinical trials and follow-up, transfer readiness, risk file, launches.
- **History:** trend charts, using daily snapshots.
- **Personalisation:** personal layouts and saved filters.
- **More channels:** push notifications with the mobile app, a daily email digest, WhatsApp alerts, and work messages written by the AI.
