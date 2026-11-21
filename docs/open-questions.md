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
| W13 | Must the VP re-approve the dates when rework or delays move the launch date? | The Head changes dates and the VP changes the launch step's. The Lead proposes a change by recording a deviation with a new date, which moves the forecast but not the plan (P57) | VP |
| W14 | What is the typical duration of each step (for dates before the Action Plan)? | Placeholder lengths in working days (`default_days`) in the route file: 5 for most paperwork steps, 10 to 20 for design and prototypes, 60 for the trials. Built (P55); the real values replace them | R&D Head |
| W15 | Does "BP" mean boilerplate? | Yes | R&D Head |
| W16 | What form does the trial set planning document take (step 19)? | An upload until defined | R&D Head |
| W17 | What codes do the product lines use in project codes? The examples show SPN (Spine) and TRM (Trauma); Arthroscopy's isn't known | ART | R&D Head |
| W18 | Steps 12, 24a and 24b are done by "the project team". Does every team member get a task at those steps, or only the Lead and DARD? | Every team member who has no other task at the step gets one | R&D Head |
| W19 | Step 16: who raises the corrective actions, who closes them, and who may decide that one is no longer needed? | The Lead raises them, and they go to the Lead unless the Lead names someone; the person they are assigned to closes them | R&D Head |
| W20 | When several people hold a role that the route needs (for example two DARD users, or two R&D Heads), who gets the task? | The role's queue, unless exactly one of them is on the project team; the Lead or Head can assign it | R&D Head |
| W21 | Can the same person submit a step and sign it off? The route lets it happen where a role both does and signs a step (for example the Lead at step 14) | Yes, as the route lists it. The step's sign-off record then carries both signatures. Separation of duties applies to a document's own rows, not to step sign-offs | VP, R&D Head |
| W22 | Which days are holidays, and which Saturdays are worked? | Monday to Friday are working days, and a few made-up holidays are loaded for local work (`SAMPLE_HOLIDAYS`). Jayon's calendar replaces them as rows of `work_calendar` | R&D Head |
| W23 | Are the timings right? A step is at risk 2 working days before it is due and not started, or when a signature has waited more than 3; a project is red when the forecast launch is more than 30 days late or a step is more than 10 working days overdue; a signature is due 3 working days after it is asked for; reminders go 2 working days before and on the due date; a late task is escalated at 2 and 5 working days | These are the starting values in `settings` and can be changed without a release | VP, R&D Head |
| W24 | Who confirms a deviation, and does the weekly exception list need to be a document? | The next role up the ladder, or anyone above, in the project's scope; the "list" is a notification to the Head and the VP at 5 working days late, plus the Delays widget (P63) | R&D Head |
| W25 | Must work given by hand (an assignment or a request, not the route's own work) also say why when it is late? Should it get reminders? | No: it isn't on the plan, so a late one can be closed without a deviation, and it gets no reminders. It still shows how late it is | R&D Head |

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
| A9 | When other departments join, does everyone in Jayon see the status of every R&D project (D6), or only R&D and the people involved? | Everyone in COAL, which is R&D and the people it works with for now | VP |
| A10 | How will employees without a company email (for example on the shop floor) sign in, once real sign-in comes? | Not needed until real sign-in | Founders, Jayon IT |
| A11 | Who keeps the source library, and who may research? | The VP, the R&D Head and the R&D Leads keep it; those three and R&D Ops (the people of steps C, 1 and 2) research. Design engineers may want literature at steps 7 and 8 later | R&D Head |

## Documents and signing

| ID | Question | Assumption in use | Ask |
|---|---|---|---|
| S1 | Who reviews each document type before approval? | The table in [documents-and-signing.md](./documents-and-signing.md#reviewers-and-approvers) | R&D Head, company QA |
| S2 | Jayon's document numbering, revision and retention conventions | Numbered `{project code}-{abbreviation}-{nn}` (for example `SPN-26-001-PID-01`; abbreviations in [documents-and-signing.md](./documents-and-signing.md#document-types)); revision letters A, B, C given at approval; keep everything | Company QA |
| S3 | Are passkey signatures enough under Indian law, and where is Aadhaar eSign or a DSC needed? | Not needed while data is made-up | An Indian lawyer |
| S4 | May someone sign on another's behalf during leave? | Not for now | VP |
| S5 | What is the policy on AI-drafted documents that will be signed? Should "AI-assisted" be printed on the PDF? | Allowed, as drafts that people review and sign; marked in the record only | Company QA |
| S6 | Who adds templates and makes a version active: company QA, the R&D Head, or both? Must templates go through Jayon's document control? | The VP or the R&D Head adds and activates (founders, 19 Nov 2026), including their own upload. No document-control step, and no two-person rule | Company QA |
| S7 | Must a step's documents be approved before the step can be submitted for sign-off? | No. The website warns, and the sign-off record lists each output with its status and hash | VP, company QA |
| S8 | Should a signed PDF show its signatures (names, meanings, dates)? | Not yet. Signatures are shown on screen and tied to the PDF's hash. A signature block and a company seal on the PDF come with the "sealed PDFs" item in [documents-and-signing.md](./documents-and-signing.md#later) | Company QA |
| S9 | Should activating a template need a second person, so nobody activates their own upload? | No (S6). It is a one-line change if wanted | VP, company QA |
| S10 | Is the product concept at step C a document, with its own template, and who writes it? | No document yet: Go records the idea's name and description, and that is the concept. A template can be added as a document type later | VP |
| S11 | May the assistant add a new **document type** from a sample (for a step whose forms aren't in COAL yet), and who decides its numbering and who signs? | Yes, on the same card, for the VP and the R&D Head. The card proposes `{project_code}-ABC-nn` numbering and Prepared, Reviewed and Approved rows, to correct before confirming ⚠ | VP, R&D Head |

## AI

| ID | Question | Assumption in use | Ask |
|---|---|---|---|
| AI2 | Which data may be sent to which AI provider? Must it be processed in India? | Only made-up data for now, so no limit yet | Jayon |
| AI3 | What response time is acceptable? (The budget is decided: [D18](./decisions.md)) | A few seconds for a question; drafts may take longer | Founders, Jayon |
| AI4 | May we use past Jayon documents to test the AI? Who scores the AI's drafts for each role? | Made-up examples until then | Jayon |
| AI5 | Is Malayalam needed in the chat and screens, or only for meetings later? | English screens; the AI may answer in Malayalam if asked | Jayon |
| AI6 | WhatsApp: Meta's own Cloud API, or a provider such as Twilio or Gupshup? | Not needed until the WhatsApp phase | Founders |
| AI7 | What may be shown in WhatsApp? Messages pass through Meta's servers | Nothing confidential until Jayon decides | Jayon |
| AI8 | How is a phone number linked to an employee's account, and unlinked when they change phones or leave? | Not needed until the WhatsApp phase | Founders, Jayon IT |
| AI9 | How long may an action card wait to be confirmed before it expires? | 72 hours (`PROPOSAL_EXPIRY_HOURS`). Confirming re-checks everything anyway, so a stale card can't do something different from what it shows | Founders |
| AI10 | Do the AI's answers on Claude match what was tested on the Copilot stand-in (D19)? | Not yet known: the AI test sets run again on Anthropic as soon as the new laptop arrives | Sharath |
| AI11 | What do the models really cost? | Starting prices by family per million tokens (Haiku $1 in and $5 out, Sonnet $3 and $15, Opus $5 and $25) set the budget. Check them against Anthropic's bills. (The model names `claude-sonnet-5-5` and `claude-haiku-5-5` were confirmed on the test deployment on 20 Nov 2026). A web search for research is counted at US$0.01 | Sharath |
| AI12 | How long are chats and AI logs kept, and may a person delete their own chats? | Kept for as long as the database is; only the owner reads a chat | Jayon |
| AI13 | Which sample files may a template be made from? | Word (`.docx`) and text PDFs (a PDF's layout can't be kept, so COAL builds a plain Word form and says so). Scans and photos are refused until a reader for them is added ⚠. Check with real samples whether PDFs read well enough | Sharath, Madhav |
| AI14 | Are the drafting checks the right ones? The assistant's number rule lets single digits through, requires a person's own words for the fields they give, and does not check dates, names or standards. The idea card shows the tasks and who gets them, not due dates or work messages | Yes for now: they stop invented figures and keep the person's fields theirs; the person reads every draft. To be judged on real drafts, with the AI test sets ([AI10](#ai)) | Sharath, Madhav |
| AI15 | The fields of a template are stored as a database object, so a form shows them in the database's key order (shorter names first), not the document's order. Should COAL keep them as an ordered list? | Not changed: it affects every template, not only those made from a sample, and the Word file's own layout is unaffected | Sharath |
| AI16 | Research sends search words to public databases (NCBI, Europe PMC, ClinicalTrials.gov, openFDA, Crossref) and, for websites, to Anthropic's web search. May it, and what may those words say? NCBI and Crossref ask for a contact address, which tells them who is searching. Should a sensitive project be able to switch research off? | Yes, with general words only: the person confirms them on a card, and COAL refuses project codes and names, people's names and the company's name. The contact address is optional (`RESEARCH_CONTACT_EMAIL`). No switch per project yet | Jayon, VP |
| AI17 | Patents: which search (PatentsView, the EPO's OPS, or Google Patents by hand), and who registers the key? | Links only for now: Google Patents and Espacenet open with the search ready | R&D Head, Sharath |

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
| I6 | COAL's web domain. Decided at the end (D13). Until then, passkeys work on `localhost`, and passkeys made on a demo host are registered again once the domain is set. The mobile app needs it too | Founders |
| I7 | Who in Jayon's IT will look after COAL day to day? | Jayon |
| I9 | Which file types must COAL accept, and how large can they be (for example CAD files, scans, videos of tests)? Assumption in use: PDF, Word, Excel, PowerPoint, CSV, text, PNG, JPEG, WebP, HEIC and STEP, up to 100 MB (`shared/src/rules/files.ts`) | Jayon IT, R&D Head |

## Business

| ID | Question | Ask |
|---|---|---|
| X1 | Is COAL built only for Jayon, or as a product for other companies too? Who owns the code and the cloud accounts? | Founders |
| X2 | After go-live: who fixes problems, how fast, and who is on call? | Founders |
| X3 | If Jayon ever leaves COAL, how do they get all their records and files out? | Founders |
| X4 | The to-do list: "My tasks" or "Docket"? | Founders |
| X5 | Which departments come after R&D, and in what order? | Founders, Jayon |

## Inputs needed from Jayon

These were listed at the COAL meeting, plus what the build needs:

- **Every current R&D form and template, as Word files, for every step.** The founders are providing these, starting with stages 1 and 2: the product concept, PID, Market Research Survey, Project Planning, Project Approval Form and Action Plan. They go in `private/templates/`, never in the repository.
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
- **The working calendar** (holidays, and Saturdays that are worked). Until it arrives, a few made-up holidays are loaded in local work ([W22](#workflow)).

## Answered

| ID | Question | Answer |
|---|---|---|
| AI1 | Which provider and models (Claude or OpenAI)? | Claude (Anthropic) only, for now ([D17](./decisions.md)). Models are set per purpose in configuration |
| I8 | Which simple host for showing COAL to employees? | A test deployment on Railway, with the same pieces as local work ([D20](./decisions.md), [demo-hosting.md](./demo-hosting.md)) |
