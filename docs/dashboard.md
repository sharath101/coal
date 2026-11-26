# Dashboard

**Read this when** you work on the Dashboard, widgets, measures, health, deadlines, alerts, deviations, a project's milestones or notifications.
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

**One shape for every widget.** `GET /widgets/{key}` returns `counts` (the headline numbers, each with a tone), `rows` and `tabs`. A row has a title, a subtitle, a link, a tone, badges, a `group`, `cells` (the values of the columns) and the `actions` this person may take, plus references (task, request, project, step) for those actions. The top few rows fill the compact card; the whole tab fills the expanded view. A client needs no widget-specific code to show a new widget, only labels for its columns.

**Grouped by product line** ([P114](./decisions.md)). Every widget whose rows belong to a project (W1 to W7) puts them under a heading for the product line of that project: Arthroscopy, then its projects or tasks; Spine, then its own; and so on. A row's `group` is that line (its id and name), and the server sorts the rows so each line's rows sit together, the lines by name, and work that is on no project (a person's own task) last under "Not on a project". Within a line the widget's own order stays (the most urgent first), so the compact card, which shows the top few rows, shows them under their lines. The expanded view adds each line's row count. A widget about people or messages (W8 to W10) has no groups, and a widget with no row in any group shows no headings.

The **Projects** page and the **My tasks** page (with its "Waiting for my signature" list) are divided the same way, by the `productLine` that their projects, tasks and signature requests carry. They are paged, so the website groups what it has loaded and adds the count of a line only once everything is. The ordering is one pure rule, `groupByLine` in `shared/` (`rules/lines.ts`), used by the server for widgets and by the website for the pages.

## First-release widgets

| # | Widget | Answers | Compact card | Expanded view |
|---|---|---|---|---|
| W1 | **My tasks** | Needs me now | Overdue, due this week, in progress; the 5 most urgent | Tabs: To do, In progress, Waiting, Done. Filters: project, step, kind, due date. Actions: start and mark done (for tasks not on a step), open the step, comment, ask for more time, open in the Workstation |
| W2 | **Waiting for my signature** | Needs me now | How many, the oldest in days, the next 3 | Each document or sign-off with its row (Prepared, Reviewed, Approved), what changed since the last version, and Sign or Return |
| W3 | **Coming up** | What's coming | My tasks that will open soon, with expected start dates | Every future task of mine across projects, and what it waits for ("Your part starts after step 5, expected 3 Feb") |
| W4 | **Upcoming checkpoints** | What's coming | The next checkpoints (4, 12, 18, 23) with dates | For each one: whether its inputs are ready and signed, and who signs |
| W5 | **My projects** | How are we doing | A card per project: a strip of the 6 stages, health, next due date, next milestone | The project list; each opens the project page |
| W6 | **R&D pipeline** | How are we doing | Projects by stage and product line, and their health | Every project: line, stage, current steps, owner, days in stage, health, forecast launch |
| W7 | **Delays and risks** | How are we doing | Overdue steps, at-risk steps, late milestones, the 3 worst slips | Each delay: project, step or milestone, owner, planned and forecast dates, days late, reason and category. The named cause only for those allowed to see it. A deviations tab |
| W8 | **Team workload** | How are we doing | Open and overdue tasks for each person below me | Person by week; reassign (where allowed) |
| W9 | **How it's going** | How are we doing | My on-time rate, and my team's | The measures below, for me and for each person below me |
| W10 | **Messages and activity** | Needs me now | My latest 5 work messages and notifications | The full feed, filters, mark as read |

### What each widget counts, as built

- **W1** my assigned tasks (signatures are on W2). "This week" runs to the coming Sunday. Tabs: To do, In progress, Waiting (the step is with its signer: not late, [P69](./decisions.md)), Done (the last 50). My own work comes first. A waiting task shows **who it waits on** instead of its own date: "With the Board" while the signers are on time, or "Board 4d late" in amber once they aren't, since that lateness is theirs; and it offers **Remind them** ([P110](./decisions.md)). Filters: project, step, kind, due (overdue, this week, later, none). A step's task offers **More time** and **Open step**, not Start or Mark done: it follows its step ([workflow.md](./workflow.md#starting-steps)). Start and Mark done are for work given by hand, own tasks and corrective actions, and a late corrective action can't be marked done until its deviation is recorded.
- **W2** the document rows waiting for me, and the step sign-offs assigned to me, oldest first.
- **W3** the steps of mine that are still locked, in projects I'm on (or lead): the step's doers include my role, or "the project team" and I'm on it. "Waits for" names the unfinished steps it depends on, with the expected date.
- **W4** the next unfinished checkpoint of each running project, with whether its inputs are finished, and who signs. Open to everyone: it is status.
- **W5** the projects I'm on, or lead, each with the next milestone not reached yet and its target date, marked when it is late or at risk. **W6** every project, with its stage, the steps open now, the Lead, days in stage, health and forecast launch; filters: product line, stage, health. Both are status, so open to everyone.
- **W7** every running project's overdue and at-risk steps, with the owner (the people holding the step's work tasks; once the step is handed in, the signers who have not signed yet, as "Board sign-off: Mira, Chet"), the planned and forecast dates, days late, and the reason and cause of the latest deviation. The cause shows by name only to those allowed; the sentence of explanation appears on the Deviations tab only for people in the project's scope ([roles-and-access.md](./roles-and-access.md#content-is-need-to-know)). Late and at-risk milestones are listed with them, marked "Milestone": the target date as planned, the step's forecast end as the forecast, and the step's owners for a step milestone. They are counted apart, as late milestones, so the overdue-steps count stays the steps'.
- **W8** (VP, R&D Head, R&D Lead, and anyone with people reporting to them on the org chart: the DARD Lead and the Asst. Managers) the open tasks of each person below me, by when they fall due. A Lead's people are those below them on the chart and everyone in R&D on their product line's projects. Only the VP, the Head and the Leads can reassign from it.
- **W9** my measures, then each person below me. The Board sees department totals, not people.
- **W10** my notifications, newest first.

### Default layouts

| Role | Widgets, in order |
|---|---|
| Board | W2, W6, W7, W4, W9 (department totals) |
| VP | W2, W1, W6, W7, W4, W8, W9, W10 |
| R&D Head | W2, W1, W7, W6, W4, W8, W9, W10 |
| R&D Lead | W1, W2, W5, W7, W4, W8, W3, W9, W10 |
| Design engineer, AEMS, PME, R&D Ops, DARD, QC inspector, Graphics designer | W1, W2, W3, W5, W10, W9 |
| Company QA, Quality Control, Production, Marketing | W1, W2, W10 |

A manager on the org chart (the DARD Lead and the two Asst. Managers) gets W8 as well, before W10, for the people who report to them.

Since everyone can see every project's status, anyone can add W6 (pipeline) to their own view once personal layouts exist.

### The project page

Opened from any widget row. It shows:

- **Header:** code, name, product line, stage, health, forecast launch, Lead.
- **The route:** all 28 steps in their stages, live: locked, ready, in progress, in review, returned, approved, not required. Overdue steps get a red ring, and reopened steps show their iteration ("×2").
- **Steps:** each step shows its doers and signer by name, tasks, documents and their signature status, dates, decisions, the prerequisites recorded at it ([workflow.md](./workflow.md#starting-steps)), comments, pictures, sources and earlier iterations.
- **Milestones:** the project's milestones beside the route, with their target dates and state ([below](#milestones)). The VP and the R&D Head add, change and remove them here.
- **Other tabs:** Documents, Timeline (planned against forecast, the milestones, and the deviations), Team, Activity.

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
  - **red** if a checkpoint is overdue, the forecast launch has slipped more than 30 days, a step is more than 10 working days overdue, or a [milestone](#milestones) is more than 10 working days late ⚠;
  - **amber** if any step is at risk or overdue, or any milestone is late or at risk;
  - **green** otherwise.

All thresholds are settings. A milestone uses the step setting (`redOverdueWorkingDays`) ⚠ ([W26](./open-questions.md#workflow)).

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
| 2 working days late | Tell the person they report to on the [org chart](./roles-and-access.md#assigning-work-and-making-requests), and, for people in R&D, the Lead of the project's line |
| 5 working days late | The task joins the exception list: one notification to the R&D Head and the VP, and a row in the Delays widget ([W24](./open-questions.md#workflow)) |
| A signature waiting | Reminders when due and every 2 working days after. An overdue VP or Board signature isn't escalated above them; the people who asked for it (those still holding the step's tasks) are told instead |
| Whenever the doers choose | **Remind them**, on the step, the doer's task or W1: each signer who has not signed yet gets the route's signature reminder, naming who sent it. Once a day per step, and recorded ([P110](./decisions.md)) |

Reminders aren't sent for a project on hold, or for a task nobody holds yet (one waiting in a queue).

**Deviations.** When a task will be late, or is, the assignee (or the Lead of the line, or the Head) records, from the task:

- **the reason**, picked from: waiting for another step, vendor delay, test lab delay, rework, person unavailable, scope change, other. Plus a sentence of explanation.
- **the cause:** a person, a role or department, or an outside party (vendor, lab, surgeon).
- **the new expected date.**

The new date becomes the task's due date (its *first* due date stays) and, while that work is open, holds the step's forecast. **A late step can't be submitted, and a late task of the route can't be closed, until a deviation explains the miss** (`DEVIATION_REQUIRED`). Once a step is handed in, the wait is its signers': the step stops asking its doers why it is late, and says instead who has not signed and how late they are ([P110](./decisions.md)). What explains a miss: for a step, a person's new date that hasn't passed yet; for a task, a deviation made for the due date it missed. Work given by hand (own tasks, assignments and requests) isn't on the plan, so it needs none ⚠ ([W25](./open-questions.md#workflow)). When the new date is missed too, the doer says why again. The project page and My tasks offer the form at that moment. The next role up the ladder, or anyone above in the project's scope (never the person who recorded it), confirms or corrects it: a correction is a new record pointing at the old one. The person or role named as the cause can add a comment. Who sees the named cause is in [roles-and-access.md](./roles-and-access.md#content-is-need-to-know).

## Milestones

A project's milestones are the targets the VP sets for it, so everyone can see whether the project is where it should be by a date ([P117](./decisions.md)). They are different for each project, and optional.

- **What a milestone is.** Either a **step of the route**, such as Board approval (4), Prototype approval (18) or Product launch (25), or something in the **VP's own words**, such as "Surgeon advisory meeting". Each may have a **target date**.
- **When they are set.** At Go the VP may add any number, or none. Afterwards the **VP and the R&D Head** ⚠ add, change (the target date, or the words) and remove them on the project page, while the project runs or is on hold. Each change asks first or ends in a button naming the act ([P107](./decisions.md)), and is recorded in the audit trail and the project's activity. A removed one is kept on record. The assistant reads them but can't change them.
- **Reached.** A step milestone is reached when its step is signed off (or marked done, for a step with no sign-off), on that day. If work is sent back and the step reopens, it isn't reached until the step is signed off again. One in the VP's own words is ticked off by the VP or the Head, with an optional note, and can be unticked.
- **State.** *Reached*; *late* once its target date has passed and it isn't reached, counted in working days; *at risk* while its step's forecast end is after the target; *on track*; or *no target date*. The state is worked out from today, so it changes as the days pass.
- **Where they show.** The project page lists them beside the route. The Timeline tab has a table of them: target, forecast and state. The Projects page and W5 show the next one not reached yet, marked when it is late or at risk. W7 lists the late and at-risk ones with the late steps. A late or at-risk milestone counts in the project's [health](#health).

These are not the prerequisites some steps wait for, such as "material received" ([workflow.md](./workflow.md#starting-steps)): those are part of the route and the same on every project.

## Notifications and work messages

| Event | Who is told |
|---|---|
| A task is made for me; my part of a step opens | The assignee, or everyone who can claim it from a queue, with a work message |
| A task is claimed or given to me by someone else | Me |
| A signature is requested | The signer |
| The doers remind the signers of a handed-in step | The signers who have not signed yet |
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
