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
| `company_qa` | Company QA | Outside R&D: test licence, regulatory submissions, transfer |
| `quality_control` | Quality Control | Outside R&D: receives the QC documents at transfer |
| `production` | Production | Outside R&D: lends machines, receives the transfer, signs the handover checklist |
| `marketing` | Marketing | Outside R&D: takes the survey forms to surgeons |

**The project team** isn't a role. It's the people named in a project's PID (step 1).

**Product lines:** Arthroscopy, Spine and Trauma.

**People outside Jayon** (vendors, outside makers, test labs, surgeons) have no accounts for now. R&D Ops or DARD upload what they send.

## Accounts, for now

COAL starts with the simplest possible accounts, so we can build and demo everything else. Real authentication comes later ([roadmap.md](./roadmap.md#later)).

- **Create an account:** enter your name and choose your role from a dropdown. A Lead also chooses their product line. Names must be unique (case doesn't matter).
- **Sign in:** enter your name. If an account with that name exists, you are in.
- **Signing documents:** the first time you sign, register Face ID or a fingerprint on your device ([documents-and-signing.md](./documents-and-signing.md#signing-with-face-id-or-fingerprint)).
- **No admin for now.** You can change your own name, role and product line from your profile.
- **One role per account** for now. Someone who needs two roles uses the more senior one ⚠.

> **This is a placeholder, not security.** Anyone can sign in as anyone, so nothing in COAL counts as an official record yet, and passkey signatures don't prove who signed. COAL holds **made-up data only** until real sign-in exists.

**Built so it can be swapped.** Sign-in lives in one backend module. It issues a session token, and everything else only uses the user ID from that session. Replacing name-only sign-in with company sign-in later changes that one module, not the rest.

## Project teams

- **At Go** ([workstation-and-ai.md](./workstation-and-ai.md#idea-to-project)), the project gets a starting team:
  - the R&D Lead of its product line;
  - the R&D Head;
  - an AEMS metallurgy expert, because the workflow says the metallurgy expert is on every team;
  - anyone the VP adds.
- **Step 1 (the PID)** names the final team. When step 1 is signed, the team is confirmed.
- **Later changes:** the Lead or the Head adds and removes members, and every change is recorded.

## What people can see

### Project status is visible to everyone

Everyone with an account can see the **status** of every project. Status means:

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

**Rules on top of the table**

- **"Team member"** means anyone on the project's team (designers, AEMS, PME, Ops, DARD, QC), plus anyone doing or signing a step of that project.
- **Drafts.** A draft is visible to the doers, reviewers and signers of its step. Everyone else who can see the project's documents sees it once it's approved.
- **Signers see what they sign.** Anyone asked to review or sign a document can read it and its inputs, even if the table would otherwise hide it.
- **Budget figures** go in a separate budget annex, so the rest of a document can be shared without them.
- **"People below"** follows the role ladder in the next section.
- **Delays.** Anyone who can't see the named cause sees only its category and the department or role.
- **History follows the record.** Anyone who can see a record can see its history: who changed or signed it, and when.
- **Anything not listed is denied.**

## What people can do

| Action | Who |
|---|---|
| Create a project (Go) | VP ⚠ |
| Work on a step's documents and tasks | That step's doers, while the step is open |
| Submit a step for sign-off | Any doer of the step |
| Sign a document row (Prepared, Reviewed, Approved) | The person the row names ([documents-and-signing.md](./documents-and-signing.md#signature-rows)) |
| Sign off a step | The step's signer ([workflow.md](./workflow.md#the-steps)) |
| Decide at a checkpoint, choose the step-15 path, send work back | As in [workflow.md](./workflow.md#decisions-recorded-at-steps) |
| Record a milestone | As in [workflow.md](./workflow.md#starting-steps) |
| Put on hold, resume, drop | VP; the Board can drop at steps 4 and 23 ⚠ |
| Change the team | Lead or Head |
| Record a deviation | The task's assignee, the Lead, the Head |
| Change dates after the Action Plan is signed | The Lead or the Head proposes; the Head approves; the VP also approves if the launch date moves ⚠ |
| Add comments, pictures and sources | Anyone who can see the record |
| Change the R&D route or a template | Not in the app yet. Developers change it in the repository, with review |

## Assigning work and making requests

Until there's an org chart, the reporting line comes from the roles ⚠:

**Board → VP → R&D Head → R&D Lead → design engineers, AEMS, PME, R&D Ops, DARD and QC inspectors**

| From | Can assign work to | Otherwise |
|---|---|---|
| Board | VP | Request |
| VP | Anyone in R&D | Request to people outside R&D |
| R&D Head | Anyone in R&D below the Head | Request |
| R&D Lead | Team members on their product line's projects | Request to anyone else |
| Everyone else | Themselves | Request to anyone |

- **Assigning.** An assigned task lands in the person's task list. It shows who assigned it, and whether it came through the AI.
- **Requests.** A request asks someone for something. They can accept it (it becomes their task) or decline it, with a reason.
- **Leave.** Covering someone's signatures while they're away comes later.

## Who gets a task

When a step opens, the engine creates one task for each doer role on the step, plus review and signature tasks as documents are submitted. Each task goes to the first match in this order:

1. The project team member who holds that role. If several do, the task goes to the role's queue for the project.
2. For the Lead role: the Lead of the project's product line. For VP and Head: the person holding that role.
3. Otherwise: the role's queue. Anyone with that role can claim it, and the Lead or Head can assign it.

**Board tasks** go to every Board member, because both must sign ⚠.

**Previews show gaps.** When a task would land in a queue, the preview at Go or at assignment says so ("No DARD user yet, so this goes to the DARD queue").

## How access is enforced

- **One permission module** in the backend decides every "can this person see or do this?" question. Screens, APIs, lists, search, Dashboard widgets, notifications and the AI's tools all use it, so they can't drift apart.
- **Lists are filtered, not just checked.** Lists and searches only return what the person may see.
- **Files** are only served through short-lived links issued after the permission check.
- **Refusals.** When content is restricted, the response says so and names who can see it. It never hints at the content itself.
- **Tests.** A table of role × action × expected result (allowed or denied) runs as tests on every change. A new endpoint without a rule fails the build.
- **The AI** acts as the person, with the same checks, plus extra limits ([workstation-and-ai.md](./workstation-and-ai.md#what-the-ai-may-do)).

## Later

These are planned but deliberately left out until we know more ([roadmap.md](./roadmap.md#later)):

- **Identity and administration:** real authentication (company sign-in), an admin role, the org chart with real reporting lines, and several roles per person.
- **Finer access control:** sensitivity labels and compartments on records and document sections, and row-level security in the database as a backstop.
- **Signing on someone's behalf:** covering a person's signatures during leave.
- **Outside access:** accounts or single-use links for outside parties, such as survey links for surgeons and accounts for test labs.
- **Auditing:** an auditor role, and a log of every view of a restricted record.
- **Leavers:** switching off people who leave, and revoking lost devices.
