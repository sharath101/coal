# Dashboard

**Read this when** you work on the Dashboard, widgets, measures, health, deadlines, alerts, deviations or notifications.
**Related:** [roles-and-access.md](./roles-and-access.md) for what each person may see, [api.md](./api.md#dashboard-and-notifications) for the widget endpoints, [workstation-and-ai.md](./workstation-and-ai.md) for "Ask AI".

---

## What the Dashboard is for

The Dashboard is one of each person's two pages; the Workstation is the other. A toggle in the top bar switches between them, on the web and in the mobile app.

The Dashboard answers three questions, in this order:

1. **What needs me now?** Tasks and signatures waiting for me.
2. **What's coming?** Work that will open soon, and upcoming checkpoints.
3. **How are we doing?** My projects, delays, and measures for me and the people below me.

Every number comes from the database, never from the AI. Every widget only counts what the viewer may see.

## Widgets

The Dashboard is a grid of **widgets**.

- **Compact card.** Each widget starts as a card with counts and the top few items.
- **Expanded view.** Clicking the card opens it into a full view with tabs, filters, a table or chart, and actions.
  - *On the web* it opens as a large panel over the Dashboard, so the grid doesn't jump.
  - *In the mobile app* it opens full screen.
  - Each expanded view has its own link (for example `/dashboard?w=my-tasks&tab=done`). Back or Esc closes it.
- **Drill-down.** Rows open the project page, the step, the document or the task.
- **Ask AI.** Every widget has an Ask AI button that opens the Workstation with that widget's data as context ([workstation-and-ai.md](./workstation-and-ai.md)).
- **Live.** When something relevant changes, the widget refreshes itself ([architecture.md](./architecture.md#events-and-live-updates)).
- **Layouts.** Each role has a default layout (below). Personal layouts come later.

**Every widget is defined in `shared/`**, so the web and mobile apps render the same thing:

```ts
interface WidgetDefinition {
  key: string;                     // 'my-tasks'
  title: string;
  defaultFor: RoleKey[];           // roles that see it by default
  compact:  { endpoint: string };  // e.g. GET /api/v1/widgets/my-tasks?view=compact
  expanded: { endpoint: string; tabs: TabDef[]; filters: FilterDef[]; actions: ActionKey[] };
  refreshOn: EventType[];          // events that make it refresh
}
```

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

| Measure | Definition |
|---|---|
| On-time rate | Tasks finished by their **first** due date ÷ tasks finished, over the last 90 days. Moving a date doesn't improve it |
| Days per task against plan | Days from when a task opens to when it's done, compared with its planned duration |
| Sign-off turnaround | Time from a signature request to the signature |
| Rework rate | Share of this person's submitted work that was returned or sent back |
| Open load | Open tasks now, and how many are overdue |
| Overdue steps | Project steps past their planned end and not yet approved |
| Schedule slip | Forecast launch minus planned launch, in days, per project |
| Days per stage | Actual days spent in each stage, against plan |

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

1. **Before the Action Plan.** Each step uses the default duration in the route definition, counted in working days from when it opens.
2. **The baseline.** The VP-signed Action Plan (step 5) gives each role on each remaining step its own planned start and end. These are entered as structured dates, not only written in the document, and become the **baseline** and everyone's due dates.
3. **Changes.** Every later change to a date is recorded. The baseline is kept, because the on-time rate is measured against it.
4. **The forecast.** Each open step's expected end is worked out from its planned duration and its inputs' expected ends. The project's forecast launch is the expected end of step 25. It's recalculated on every change and every night.

**The working calendar.** Jayon's holidays and working Saturdays. Dates are shown in Indian time.

**Reminders and escalation.** These timings are settings, not code.

| When | What happens |
|---|---|
| 2 working days before the due date | A reminder to the assignee |
| On the due date | A reminder to the assignee and to the step's signer. The task turns red. The assignee is asked for a new expected date and the reason |
| 2 working days late | Tell the next role up the ladder ([roles-and-access.md](./roles-and-access.md#assigning-work-and-making-requests)) |
| 5 working days late | The task joins the weekly exception list of the R&D Head and the VP |
| A signature waiting | Reminders when due and every 2 working days after. An overdue VP or Board signature isn't escalated above them; the person who asked for it is told instead |

**Deviations.** When a task finishes late, or its forecast moves past its due date, the assignee records:

- **the reason**, picked from: waiting for another step, vendor delay, test lab delay, rework, person unavailable, scope change, other. Plus a sentence of explanation.
- **the cause:** a person, a role or department, or an outside party (vendor, lab, surgeon).
- **the new expected date.**

The next role up confirms or corrects it. A correction is a new record pointing at the old one. A late task can't be closed until its deviation is recorded. The person named as the cause can add a comment. Who sees the named cause is in [roles-and-access.md](./roles-and-access.md#content-is-need-to-know).

## Notifications and work messages

| Event | Who is told |
|---|---|
| A task or request is assigned to me; my part of a step opens | The assignee, with a work message |
| A signature is requested | The signer |
| Work is returned for rework | The authors and doers |
| Reminders and escalations | As in the table above |
| A checkpoint is decided; a project is put on hold or dropped | The project team |
| I'm mentioned in a comment | Me |

- **Channels:** in-app (web and mobile) and mobile push. Email follows once accounts have email addresses. WhatsApp comes later.
- **Work messages** are written from templates in the route definition. For example: *"Your part on SPN-26-004: step 1, the Project Initiation Document, with the Spine Lead. The VP signs. Due 27 Nov. Input: the concept."*
- **Privacy.** Push notifications show no project details, for example "You have 1 new task in COAL". Opening the app shows the details.

## Later

- **Widgets for the step modules** as they're built: budget and cost, procurement and outsourcing, design and FEA, prototypes and QC queue, machines and OEE, testing, regulatory readiness, market feedback, clinical trials and follow-up, transfer readiness, risk file, launches.
- **History:** trend charts, using daily snapshots.
- **Personalisation:** personal layouts and saved filters.
- **More channels:** a daily email digest, WhatsApp alerts, and work messages written by the AI.
