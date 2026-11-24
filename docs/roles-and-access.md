# Roles and access

**Read this when** you work on accounts, roles, project teams, who sees what, who can do what, task assignment, or permission checks.
**Related:** [workflow.md](./workflow.md) for who does and signs each step, [api.md](./api.md) for the permission on each endpoint, [workstation-and-ai.md](./workstation-and-ai.md#what-the-ai-may-do) for what the AI may do on someone's behalf.

⚠ marks an assumption. See [open-questions.md](./open-questions.md#people-and-access).

---

## Roles

| Key | Role | Who holds it |
|---|---|---|
| `board` | Board | The Managing Director and the CEO. They sign only as the Board, at steps 4 and 23 |
| `vp` | VP | Product strategy and global business development |
| `rd_head` | R&D Head | Head of R&D |
| `rd_lead` | R&D Lead | Lead of one product line: Arthroscopy, Spine or Trauma |
| `design_engineer` | Design engineer | Makes the 3D models and drawings in SolidWorks |
| `aems` | AEMS | Advanced Engineering and Materials Science: the FEA and metallurgy experts |
| `pme` | PME | Prototype Manufacturing and Engineering: makes the prototypes, trial sets and master set |
| `rd_ops` | R&D Ops | R&D Operations, including the R&D Ops Assistant Manager |
| `dard` | DARD | Design Assurance and Regulatory Documentation |
| `qc_inspector` | QC inspector | Part of DARD; inspects each prototype |
| `graphics_designer` | Graphics designer | Makes graphics for R&D. No step of the route names it: it gets the work it is given |
| `company_qa` | Company QA | Outside R&D: test licence, regulatory submissions, transfer |
| `quality_control` | Quality Control | Outside R&D: receives the QC documents at transfer |
| `production` | Production | Outside R&D: lends machines, receives the transfer, signs the handover checklist |
| `marketing` | Marketing | Outside R&D: takes the survey forms to surgeons |
| `admin` | Admin | The demo admin: only moves between people, and has no part in the route. Temporary ([P113](./decisions.md)); see [Switching people for the demo](#switching-people-for-the-demo) |

A **role** is what a person may do on the route. Who someone is on Jayon's org chart is their **position**, below, which holds one role.

**The project team** isn't a role. It's the people named in a project's PID (step 1).

**Departments.** Each role belongs to a department. Both are stored as data, so new departments and roles can be added without changing the code ([data-model.md](./data-model.md#people-and-sessions)). For now:

- **R&D:** `rd_head` to `graphics_designer` in the table above;
- **the departments R&D works with:** Quality Assurance (`company_qa`), Quality Control (`quality_control`), Production and Marketing;
- **above departments:** the Board and the VP.

**Product lines:** Arthroscopy, Spine and Trauma.

**People outside Jayon** (vendors, outside makers, test labs, surgeons) have no accounts for now. R&D Ops or DARD upload what they send.

## The org chart

Jayon's R&D chart gives each person a **position**: its title, the role it holds, who it reports to and how many people may hold it (**seats**). Positions are data like roles ([P111](./decisions.md)); the made-up people in the demo fill them. AM (additive manufacturing) isn't part of R&D's route, so it isn't on the chart here.

| Position | Role | Reports to | Seats |
|---|---|---|---|
| Managing Director | Board | | 1 |
| CEO ⚠ (not on the chart; the workflow has the MD and the CEO sign as the Board, [W2](./open-questions.md#workflow)) | Board | | 1 |
| VP, Product Strategy & Global BD | VP | Managing Director | 1 |
| R&D Head | R&D Head | VP | 1 |
| R&D Lead | R&D Lead | R&D Head | 1 for each product line |
| Design engineer | Design engineer | the R&D Lead of their line | 5 for each product line |
| Metallurgy expert | AEMS | R&D Head | 1 |
| FEA expert | AEMS | R&D Head | 1 |
| Asst. Manager, R&D Ops | R&D Ops | R&D Head | 1 |
| Operations analyst | R&D Ops | Asst. Manager, R&D Ops | 1 ⚠ ([A12](./open-questions.md#people-and-access)) |
| Graphics designer | Graphics designer | Asst. Manager, R&D Ops | 2 |
| DARD Lead | DARD | R&D Head | 1 |
| DARD engineer | DARD | DARD Lead | 2 |
| QC inspector | QC inspector | DARD Lead | 3 |
| Asst. Manager, PME | PME | R&D Head | 1 |
| PME staff (production in-charges, CNC setters and operators, machinists, assembly) | PME | Asst. Manager, PME | no limit |
| Company QA, Quality Control, Production, Marketing | the same | | no limit |
| Admin | Admin | | 1; not offered at sign-up |

- **The route uses roles, the chart uses positions.** A Lead and a design engineer are different positions, but the route only asks for "the R&D Lead" and "design engineers". Two positions of one role do the same route work.
- **Seats.** A position with a seat count can't be chosen once it is full. Only accounts that are switched on count. Where seats are counted for each product line, a Lead or a design engineer also chooses their line, and each line has its own seats.
- **Reporting.** A person reports to the nearest person above them on the chart. The chart is what [assigning work](#assigning-work-and-making-requests), confirming a deviation, delay names, Team workload and the morning escalations follow. The roles outside R&D aren't on the chart ([A4](./open-questions.md#people-and-access)).
- **The Lead runs their line's projects.** On the projects of their product line a Lead also stands above everyone in R&D on the project team, as they did before the chart ([P112](./decisions.md)). The managers (the DARD Lead and the two Asst. Managers) direct the people who report to them.
- **The People page** shows the chart with the people in each box and the seats still open, to everyone signed in.

## Accounts, for now

COAL starts with the simplest possible accounts, so we can build and demo everything else. Real authentication comes later ([roadmap.md](./roadmap.md#later)).

- **Create an account:** enter your name and choose your position from a dropdown. A Lead or a design engineer also chooses their product line. A position with no seat left can't be chosen. Names must be unique (case doesn't matter).
- **Sign in:** enter your name. If an account with that name exists, you are in.
- **Signing documents:** for now, a signature is a confirmed click by the right person. In the last block you will register Face ID or a fingerprint on your device the first time you sign ([documents-and-signing.md](./documents-and-signing.md#signing-with-face-id-or-fingerprint)).
- **No admin for now,** except the temporary demo admin ([below](#switching-people-for-the-demo)). You can change your own name, position and product line from your profile; a full position can't be taken.
- **One position, and so one role, per account** for now. Someone who needs two roles uses the more senior one ⚠.

> **This is a placeholder, not security.** Anyone can sign in as anyone, so nothing in COAL counts as an official record yet, and signatures (a click now, passkeys later) don't prove who signed. COAL holds **made-up data only** until real sign-in exists.

**Built so it can be swapped.** Sign-in lives in one backend module. It issues a session token, and everything else only uses the user ID from that session. Replacing name-only sign-in with company sign-in later changes that one module, not the rest.

## Project teams

- **At Go** ([workstation-and-ai.md](./workstation-and-ai.md#idea-to-project)), the project gets a starting team:
  - the R&D Lead of its product line;
  - the R&D Head;
  - an AEMS metallurgy expert, because the workflow says the metallurgy expert is on every team (the metallurgy expert's position, not the FEA expert's);
  - anyone the VP adds.
- **Step 1 (the PID)** names the final team. When step 1 is signed, the team is confirmed.
- **Later changes:** the Lead or the Head adds and removes members, and every change is recorded.

## What people can see

### Project status is visible to everyone

Everyone with an account can see the **status** of every project. For now, that means R&D and the people it works with. Whether this stays true for everyone once other departments join is open ⚠ ([A9](./open-questions.md#people-and-access)). Status means:

- the code, name, product line, stage and health;
- each step's state, doers and signer;
- planned and forecast dates;
- the category of any blocker or delay (not its details).

### Content is need-to-know

| Content | Board | VP | R&D Head | R&D Lead | Team member | Others in R&D | Outside R&D |
|---|---|---|---|---|---|---|---|
| Project documents and records | Checkpoint papers | All | All | Own product line | Their projects | — | Only items sent to them |
| Budget and cost figures | All | All | All | Own product line | R&D Ops on the project | — | — |
| Board papers (steps 4 and 23) | All | All | All | Outcome only | — | — | — |
| Who caused a delay (by name) | — | All | All | People below them | Themselves | — | — |
| Productivity measures | Department totals | Own and people below | Own and people below | Own and people below | Own | Own | Own |
| AI chats | Owner only | Owner only | Owner only | Owner only | Owner only | Owner only | Owner only |
| Research runs (the brief and results not yet kept) | Owner only | Owner only | Owner only | Owner only | Owner only | Owner only | Owner only |

**Rules on top of the table**

- **"Team member"** means anyone on the project's team (designers, AEMS, PME, Ops, DARD, QC), plus anyone doing or signing a step of that project.
- **Drafts.** A draft is visible to the doers, reviewers and signers of its step. Everyone else who can see the project's documents sees it once it's approved.
- **Signers see what they sign.** Anyone asked to review or sign a document can read it and its inputs, even if the table would otherwise hide it.
- **Budget figures** go in a separate budget annex, so the rest of a document can be shared without them.
- **Board papers** are the documents of the steps the Board signs (4 and 23). The Board, the VP and the Head read them; the Lead of the product line sees that they exist and where they stand, not their content; the team doesn't see them.
- **Checkpoint papers** are the documents of the checkpoint steps (4, 12, 18 and 23). Those are the only project documents the Board reads, and only once they are submitted.
- **The budget annex** is a document type of its own (`BUDGET_ANNEX`), read by the Board, the VP, the Head, the Lead of the product line and R&D Ops on the project, and by anyone asked to sign it. Other team members don't see it, nor that it exists.
- **A document with only drafts** isn't listed for anyone except the people who work on the project (the VP, the Head, the Lead of the line, the team). Others see it once it is submitted.
- **Attachments and sources** follow what they are attached to: a document's, or the step's. The Board sees a step's only at checkpoints.
- **"People below"** follows the org chart, plus the Lead's own line ([The org chart](#the-org-chart)).
- **Delays.** Anyone who can't see the named cause sees only its category and the department or role. The VP and the Head see every name; a person sees themselves and the people below them on the chart, a Lead also everyone in R&D on their line's projects, and the Board no names (A3); and whoever recorded a deviation sees the cause they named. An outside party's name shows to people in the project's scope. The sentence of explanation, a review's note, the comments, the reason for a date change and the title of a corrective action's task are content, shown only to people in the project's scope ([P61](./decisions.md)).
- **The Dashboard counts only what its viewer may see.** Status (health, stage, dates, owners, the category of a delay) is open to everyone, so the pipeline and the checkpoints list every project. Tasks, signatures, "coming up" and "my projects" are the person's own. Team workload and the measures of other people follow the org chart: the VP and the Head see everyone below them, a Lead the people below them and everyone on their line's projects, a manager (the DARD Lead, the Asst. Managers) the people who report to them, the Board department totals only.
- **History follows the record.** Anyone who can see a record can see its history: who changed or signed it, and when. The project's activity feed follows the same rule for documents: an event about a document is shown only to people who may read it (a team member never sees events about the budget annex, nor the return comment on a Board paper), and drafts only to the people who work on the project.
- **The sign-off record leaves out the budget annex.** Everyone on the team reads a step's sign-off record, so it lists the step's other outputs but not need-to-know documents. The annex is signed on its own.
- **Anything not listed is denied.**

## What people can do

| Action | Who |
|---|---|
| Create a project (Go), and see what Go would do for a concept (`POST /projects/preview`, which the assistant may use) | VP ⚠. Go itself is never the assistant's |
| Make or change a step's documents (save versions, submit them for signing) | That step's doers, while the step is open and the project is running |
| Start or submit a step | Any doer of the step, and the project team where the route names it |
| Remind the signers of a handed-in step | Any doer of the step (once a day per step) |
| Sign a document row (Prepared, Reviewed, Approved) | The person the row names, or anyone holding its role within the project's scope; never Approved by the person who prepared the version ([documents-and-signing.md](./documents-and-signing.md#signature-rows)) |
| Sign off a step | The step's signer ([workflow.md](./workflow.md#the-steps)) |
| Decide at a checkpoint, choose the step-15 path, send work back | As in [workflow.md](./workflow.md#decisions-recorded-at-steps) |
| Record a milestone | As in [workflow.md](./workflow.md#starting-steps) |
| Put on hold, resume, drop | VP; the Board can drop only while step 4 or 23 is open ⚠ |
| Change the team | Lead (of the product line) or Head |
| Raise a corrective action | The Lead, while the case study is open ⚠ |
| Claim a queued task; give a task to someone | Anyone with the role; the VP or Head; the Lead within the project team |
| Make a task for yourself, assign work or make a request | Anyone: [the org chart](#assigning-work-and-making-requests) decides whether it is assigned or asked. Tying it to a project needs the person to be in the project's scope |
| Accept or decline a request | The person it was made of |
| Confirm or discard a proposal (action card) | Only the person it was prepared for, from their own session ([api.md](./api.md#proposals-and-action-cards)) |
| Record a deviation | The task's assignee, the Lead of the line, the Head |
| Confirm or correct a deviation | Someone above the person who recorded it on the org chart, or the Lead of the line for people in R&D on the project, within the project's scope; never the person who recorded it |
| Comment on a deviation | The person, or anyone holding the role, named as its cause |
| Write the plan's dates (step 5) | The doers of the Action Plan step: the Lead and the Head, while it is open and not under review |
| Change dates after the Action Plan is signed | The Head, with a reason. Only the VP changes the launch step (25). The Lead proposes by recording a deviation with a new date ⚠ ([W13](./open-questions.md#workflow)) |
| Add pictures, files and sources | The people who do or sign the step, and the project team |
| Add comments | Anyone who can see the record |
| Change the R&D route | Not in COAL yet. Developers change it in the repository, with review |
| Add a template; make a template version active | VP or R&D Head, including their own upload ⚠ ([documents-and-signing.md](./documents-and-signing.md#adding-a-template)). The assistant may prepare a template on their behalf, on an action card; activating stays their own act |
| Read a template | Everyone reads the active ones; the VP and the Head also read drafts and retired versions |
| Add, change or switch off a place in the source library | VP, R&D Head, R&D Leads ⚠ ([A11](./open-questions.md#people-and-access)). Everyone reads the library |
| Research in public sources | VP, R&D Head, R&D Leads, R&D Ops: the people of steps C, 1 and 2 ⚠ ([A11](./open-questions.md#people-and-access)). The assistant prepares the card; the person confirms the search words |
| Keep research results as sources of a project (or of one step) | The person who ran the research, into a project they are on, or the VP, the Head or the Lead of its line; for a step, one they may add sources to (above) |

## Assigning work and making requests

The reporting line is [the org chart](#the-org-chart): MD → VP → R&D Head → the Leads, the Metallurgy and FEA experts, the Asst. Managers and the DARD Lead → their own people.

| From | Can assign work to | Otherwise |
|---|---|---|
| Board | VP | Request |
| VP | Anyone in R&D | Request to people outside R&D |
| R&D Head | Anyone in R&D below the Head | Request |
| R&D Lead | Their line's design engineers, and anyone in R&D on the team of a project of their product line (of that project, when the work is tied to one) | Request to anyone else |
| DARD Lead, Asst. Manager R&D Ops, Asst. Manager PME | The people who report to them | Request to anyone else |
| Everyone else | Themselves | Request to anyone |

One pure rule decides it (`howToGive` in `rules.ts`), and `POST /tasks` follows it: the person never picks "assign" or "request" themselves.

- **Assigning.** An assigned task lands in the person's task list. It shows who assigned it, and whether it came through the AI (the Workstation).
- **Requests.** A request asks someone for something. They can accept it (it becomes their task; starting it also accepts it) or decline it, with a reason. The person who asked is told either way, and sees the reason on the task under "Given by me"; the notification itself never carries it.
- **Through the AI.** The AI may make the user's own tasks directly. Work for anyone else goes on an action card that the user confirms.
- **Leave.** Covering someone's signatures while they're away comes later.

## Who gets a task

When a step opens, the engine creates one task for each doer role on the step, plus a sign-off task when the step is submitted (and review tasks as documents are submitted, later). Where the doer is "the project team", every team member without another task at the step gets one ⚠ ([W18](./open-questions.md#workflow)). Each task goes to the first match in this order:

1. The project team member who holds that role, when exactly one does. If several do, the task goes to the role's queue.
2. For the Lead role: the Lead of the project's product line. For VP and Head: the person holding that role. Each only when exactly one person qualifies; with several, the task goes to the queue ⚠ ([W20](./open-questions.md#workflow)).
3. Otherwise: the role's queue. Anyone with that role can claim it.

**Claiming.** Anyone with the role can claim a task from the queue (a role queue never shows another role's tasks), except that a Lead can claim only for projects of their own product line. Claiming joins the person to the project team, so they can act on the step. The VP or the Head can give a task to anyone holding its role; the Lead can give it to people already on the project team.

**The starting team.** At Go, the team is the Lead of the product line, the Head and the metallurgy expert, each when exactly one person holds the position, plus anyone the VP ticks. Anyone else joins by claiming a task or when the Lead or Head changes the team.

**Board tasks** go to every Board member, because both must sign ⚠. If nobody holds the Board role yet, the task goes to the Board queue.

**Previews show gaps.** When a task would land in a queue, the preview at Go or at assignment says so ("No DARD user yet, so this goes to the DARD queue").

## Switching people for the demo

**Temporary, and gone before the hand-off ([P113](./decisions.md)).** For the demo, an **admin** account moves between people without signing out, so one person can show what the VP, the Head and a designer each see.

- **Who and how.** Sign in as *Admin* (made by `seed:demo`). A circle at the top of every page opens a list of everyone: one click takes that person's place, and the list stays there, so the admin can go from Vera to Hari to Mira, and back to the admin. The People page does the same by clicking a name, and asks first.
- **Only from an admin's session.** The circle appears only in a session an admin started by signing in or switching. Signing out and signing in by name gives an ordinary session with no circle, and `POST /auth/switch` refuses it.
- **As the person.** After a switch everything is done as that person, with their role and their checks: the admin has no powers of their own on the route. The switch is recorded in the audit trail under the admin (`session.switched`). The AI can never switch ([api.md](./api.md#accounts-and-profile)).
- **The admin isn't a colleague.** They don't appear in the directory, the chart, search, teams or the sign-up form, and have no tasks.
- **One setting turns it off:** `ADMIN_SWITCHING` (off unless set). Off, the admin account can't sign in, nothing can switch, and a session reached by switching no longer counts. The code stays small and in one place (`auth/routes.ts`, `resolveSession`, `PersonSwitcher`, the People page's switch), so it can be removed at the hand-off ([demo-hosting.md](./demo-hosting.md#before-the-hand-off)).
- **It is a placeholder like name-only sign-in.** Real sign-in comes first ([A8](./open-questions.md#people-and-access)); nothing like this exists then.

## How access is enforced

- **One permission module** in the backend (`backend/src/modules/permissions/`) decides every "can this person see or do this?" question. Screens, APIs, lists, search, Dashboard widgets, notifications and the AI's tools all use it, so they can't drift apart.
- **Project rules.** Acting on a project takes two things. The role must be one the route names for that action *right now* (for example, only the signer approves, only the Head sends work back, and who may drop depends on which step is open). And the person must be in scope: the Board, the VP and the Head on any project, a Lead on their product line's projects, and everyone else on projects whose team they are on. A refusal names who can.
- **Comments and reasons are content.** A return comment, a send-back reason, a decision's reason and a corrective action's text are visible to people in the project's scope. Everyone else sees the status of each event and step, not the words.
- **Lists are filtered, not just checked.** Lists and searches only return what the person may see.
- **Documents** follow [the need-to-know table](#content-is-need-to-know), decided by one pure rule (`documentAccess` in `rules.ts`) that the document endpoints, file links and attachments all use. The rule's cases have their own table in `permissions.test.ts`.
- **Files** are only served through short-lived links issued after the permission check: to the uploader, or to anyone who may see a record that holds the file.
- **Refusals.** When content is restricted, the response says so and names who can see it. It never hints at the content itself. A test checks that every refusal of every permission names who can, in role names ([P103](./decisions.md)).
- **Tests.** A table of role × action × expected result (allowed or denied) runs as tests on every change (`permissions.test.ts`). A new endpoint without a rule fails the build.
- **The AI** acts as the person, with the same checks, plus extra limits ([workstation-and-ai.md](./workstation-and-ai.md#what-the-ai-may-do)).

## Later

These are planned but deliberately left out until we know more ([roadmap.md](./roadmap.md#later)):

- **Identity and administration:**
  - real authentication (company sign-in), with a way in for employees without a company email;
  - a real admin role (the demo admin is temporary: [above](#switching-people-for-the-demo));
  - the org chart kept up to date by Jayon (today it is the chart as drawn in the catalogue);
  - several roles per person.

  All of these come before other departments join.
- **Finer access control:** sensitivity labels and compartments on records and document sections, and row-level security in the database as a backstop.
- **Signing on someone's behalf:** covering a person's signatures during leave.
- **Outside access:** accounts or single-use links for outside parties, such as survey links for surgeons and accounts for test labs.
- **Auditing:** an auditor role, and a log of every view of a restricted record.
- **Leavers:** switching off people who leave, and revoking lost devices.
