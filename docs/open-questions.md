# Open questions

**Read this when** a doc marks something ⚠, or before building something that depends on an answer.
**Related:** [decisions.md](./decisions.md) for what is decided.

---

## How this list works

- **Each question has an ID** that other docs link to. Where we use an assumption meanwhile, it's stated here and marked ⚠ in the docs.
- **When a question is answered:**
  1. record the answer in [decisions.md](./decisions.md);
  2. update the affected docs and remove their ⚠;
  3. move the question to "Answered" at the end, with a link to the decision.
- **New questions** get the next ID in their group.
- **"Ask"** names who is likely to know. Names come from the COAL meeting notes.

## Workflow

| ID | Question | Assumption in use | Ask |
|---|---|---|---|
| W1 | Step 2a (regulatory planning): where exactly does it sit, who does it, who signs it, and which steps wait for it? | Lead and DARD; starts at Go; no sign-off; only step 22 waits for it | Akhil |
| W2 | Must both the MD and the CEO sign at steps 4 and 23? Are these statutory Board resolutions? If the Board says no, does the work go back (to 3 or 22), go on hold, or close? | Both sign; a no is recorded as a decision and the VP decides what next | VP, company secretary |
| W3 | The CDSCO test licence: must it be granted before prototypes are made, or only applied for? Do internal bench prototypes need it? Which instruments are exempt? Who records it? | A "test licence recorded" milestone, entered by DARD for the company QA team | Company QA |
| W4 | Step 13: which documents does R&D Ops sign and which does the Lead sign? Who has the final say on a failure? Does an instrument-only failure go back to step 7 or 8? | The Head confirms a failure; instrument-only failures may go to 8 | R&D Head |
| W5 | Step 20: does the Head sign off after the surgeries or after the one-year follow-up? How does the follow-up run, and which scores are used? | Signed off when the follow-up is complete; step 21 starts at "surgeries complete" | Akhil |
| W6 | Steps 24a and 24b: who signs 24a? Are the "about 50 cases" the step-20 cases? Does step 23 also wait for them? Which documents make up the transfer? Do the Quality Control managers sign? Who gives and receives the training? | 24a has no sign-off; the Lead records the threshold by hand | R&D Head, VP, company QA |
| W7 | Who may put a project on hold or drop it, and when must the VP or Board confirm? | The VP at any time; the Board at 4 and 23 | VP |
| W8 | After the trials, does an instrument-only design change go back to step 8 or restart at 10? Where are drawings revised before the loop back to 10? | Restart at 10; instrument-only changes decided case by case | R&D Head |
| W9 | Step 5: is the raw material defined before or after the FEA at steps 7 and 8? | Defined at step 5 and updated later if needed | R&D Head |
| W10 | Step 6: what exactly does DARD do in the raw material test, and which audit procedure documents go with it? | DARD is a doer of step 6 | Akhil |
| W11 | Steps 10 and 11: who approves the Material Issue Slip? | Not modelled yet | R&D Head |
| W12 | Step 15: when no study is needed, who writes and signs the justification? | R&D Ops and DARD write it; the Lead signs | R&D Head |
| W13 | Must the VP re-approve the dates when rework or delays move the launch date? | The Head approves date changes; the VP too if the launch moves | VP |
| W14 | What is the typical duration of each step (for dates before the Action Plan)? | Placeholder durations in the route definition | R&D Head |
| W15 | Does "BP" mean boilerplate? | Yes | R&D Head |
| W16 | What form does the trial set planning document take (step 19)? | An upload until defined | R&D Head |

## People and access

| ID | Question | Assumption in use | Ask |
|---|---|---|---|
| A1 | Should Leads see the content of all three product lines, or only their own? | Only their own line (status of all is open to everyone) | VP, R&D Head |
| A2 | Who may see budgets and costs? May PME see prototype cost totals? | Board, VP, Head; the Lead for their line; R&D Ops on the project | VP |
| A3 | Who may see the named cause of a delay? May the Board see named individuals' measures? | The person named, the roles above them, VP and Head; the Board sees department totals only | VP |
| A4 | The org chart: who holds each role, who reports to whom, can one person hold several roles, can a line have more than one Lead? | The role ladder; one role per account | R&D Head |
| A5 | Who can create a project: only the VP, or the R&D Head too? | Only the VP | VP |
| A6 | Will outside parties (labs, vendors, surgeons) get accounts or single-use links? | No access for now; R&D Ops or DARD upload what they send | R&D Head |
| A7 | Must a person accept a task assigned to them, or only a request? | Only requests need accepting | Founders |
| A8 | Which authentication method (company Microsoft or Google sign-in, email codes) and how admin works | Name-only placeholder; no admin | Founders |

## Documents and signing

| ID | Question | Assumption in use | Ask |
|---|---|---|---|
| S1 | Who reviews each document type before approval? | The table in [documents-and-signing.md](./documents-and-signing.md#first-templates) | R&D Head, company QA |
| S2 | Jayon's document numbering, revision and retention conventions | `{project code}-{type}-{nn}`; keep everything | Company QA |
| S3 | Are passkey signatures enough under Indian law, and where is Aadhaar eSign or a DSC needed? | Not needed while data is made-up | An Indian lawyer |
| S4 | May someone sign on another's behalf during leave? | Not for now | VP |
| S5 | What is the policy on AI-drafted documents that will be signed? Should "AI-assisted" be printed on the PDF? | Allowed, as drafts that people review and sign; marked in the record only | Company QA |

## AI

| ID | Question | Assumption in use | Ask |
|---|---|---|---|
| AI1 | Which provider and models (Claude or OpenAI)? | Both integrated; choose after testing on real tasks | Founders |
| AI2 | Which data may be sent to which AI provider? Must it be processed in India? | Only made-up data for now, so no limit yet | Jayon |
| AI3 | What is the AI budget per person or per month, and what response time is acceptable? | A daily budget per person, set in configuration | Founders, Jayon |
| AI4 | May we use past Jayon documents to test the AI? Who scores the AI's drafts for each role? | Made-up examples until then | Jayon |
| AI5 | Is Malayalam needed in the chat and screens, or only for meetings later? | English screens; the AI may answer in Malayalam if asked | Jayon |

## Regulatory

These matter when the [regulatory notes](./regulatory-notes.md) are taken up.

| ID | Question | Ask |
|---|---|---|
| R1 | Which clinical route applies to each device: is an equivalent device already approved in India? | Company QA, DARD |
| R2 | Does Jayon's QA run a quality system (eQMS) or hold ISO 13485 certification? Which EU notified body is planned? | Company QA |
| R3 | What are the target markets (India, CE, FDA) and their order? Which devices come next? | VP |
| R4 | What is Jayon's regulatory status: CDSCO licences held, certificates, notified body, US agent? | Company QA |
| R5 | Do CDSCO forms other than the portal application need a DSC? | Company QA |
| R6 | Review meeting recordings: do participants consent, and how long are recordings kept? | R&D Head |

## IT and data

| ID | Question | Ask |
|---|---|---|
| I1 | Which email system (Microsoft 365 or Google Workspace)? | Jayon IT |
| I2 | Which ERP, where does it run, and does it have an API? | Jayon IT |
| I3 | Which SolidWorks version, PDM, Simulation licences, and how many CAD editors? | Jayon IT |
| I4 | The machine, software and instrument lists. The collection sheet is in [archive/PLAN.md, Appendix C](./archive/PLAN.md#appendix-c--what-to-collect-for-the-machine-software-and-instrument-lists) | Jayon |
| I5 | Where are existing R&D documents kept? Which projects are under way, at which steps, and do they move into COAL? | R&D Head |
| I6 | COAL's web domain. It must be decided before passkeys are built, because the app and website share passkeys through it | Founders |
| I7 | Who in Jayon's IT will look after COAL day to day? | Jayon |

## Business

| ID | Question | Ask |
|---|---|---|
| X1 | Is COAL built only for Jayon, or as a product for other companies too? Who owns the code and the cloud accounts? | Founders |
| X2 | After go-live: who fixes problems, how fast, and who is on call? | Founders |
| X3 | If Jayon ever leaves COAL, how do they get all their records and files out? | Founders |
| X4 | The to-do list: "My tasks" or "Docket"? | Founders |

## Inputs needed from Jayon

These were listed at the COAL meeting, plus what the build needs:

- **Every current R&D form and template**, as Word files, starting with stages 1 and 2: the product concept, PID, Market Research Survey, Project Planning, Project Approval Form and Action Plan.
- **The Action Plan document**, with the data for its boilerplate (Bharath).
- **The audit procedure documents and the NCP document** (Akhil).
- **Step documents:**
  - the FEA report;
  - the prototype case study;
  - the testing and validation document for CE and FDA;
  - the trial set planning document;
  - the ERP version of the Material Issue Slip;
  - a sample QC inspection report;
  - all manufacturing-related documents.
- **Lists:** the machines, the software used, and the inspection instruments.
- **People:** the org chart and the people in each role.
- **The working calendar** (holidays).

## Answered

*None yet.*
