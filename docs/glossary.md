# Glossary

**Read this when** a word or abbreviation in the docs or the code is unclear. Use these words consistently in code, screens and docs.

---

## Words we use

| Word | Meaning in COAL |
|---|---|
| **Action card** | How a proposal appears in the Workstation: what will happen, with Confirm, Edit and Cancel |
| **AI tier** | What the AI may do with an endpoint: `read`, `auto`, `confirm` or `never` ([workstation-and-ai.md](./workstation-and-ai.md#what-the-ai-may-do)) |
| **Baseline** | The planned dates from the signed Action Plan (step 5), written there for each role and step; the VP's sign-off makes them permanent. The on-time rate is measured against first due dates, and later changes are recorded beside the baseline |
| **Grounding** | What a draft the assistant saves must rest on: what the person said in the chat, and what the tools returned in that reply. The server checks a draft's numbers and the person's fields against it ([workstation-and-ai.md](./workstation-and-ai.md#drafting-a-document)) |
| **Boilerplate (BP)** | A company template that new documents start from, such as the Action Plan or the FEA report. In COAL, a template in the template library |
| **Channel** | Where a person uses the AI chat: the website now; WhatsApp and the mobile app later |
| **Checkpoint** | A go or no-go step: 4, 12, 18 and 23. Nothing after it starts until it is signed |
| **Outside chat** | A chat that holds a file from outside the company's records (a sample document, later a lab report). The assistant there can only prepare action cards ([workstation-and-ai.md](./workstation-and-ai.md#safety-basics)) |
| **Citation** | A link from a statement in an AI answer to the record it came from (`[S1]`). The server keeps only citations that match a record the AI actually read ([workstation-and-ai.md](./workstation-and-ai.md#citations)) |
| **Content** | What's inside a project's documents and records. Visible on a need-to-know basis (compare *status*) |
| **Decision** | A signed choice recorded at a step: Go, a checkpoint outcome, "prototypes OK", "pre-clinical study needed", hold, drop |
| **Department module** | The part of the backend that holds one department's own records and rules. R&D's is the first |
| **Corrective action** | A fix listed in the prototype case study (step 16). Each is a task, and step 18 can't be submitted while any is open |
| **Deviation** | A record explaining late work: the reason, the cause and the new date. A late step can't be submitted, nor a late task closed, until one is recorded; the next role up confirms or corrects it |
| **Doer** | A role or person who does the work of a step (as opposed to its signer) |
| **Document type** | A kind of document (PID, Action Plan, Budget annex…) with its numbering, signature rows and sensitivity ([documents-and-signing.md](./documents-and-signing.md#document-types)) |
| **Draft, version, revision** | Each save makes a new numbered draft version, and nothing is overwritten. A revision letter (A, B, C) is given when a version is approved |
| **Fields and written sections** | The two kinds of part in a template. Fields are filled by code, from records or from the person's answers; written sections are written by a person or the AI |
| **Carried forward** | A document version copied unchanged into a step's new iteration when work is sent back, so people revise rather than start again |
| **Confirmed click** | How every signature is made until passkeys exist: the right person confirms, and COAL records who, when and the hashes |
| **Forecast** | The expected end of each open step, and the expected launch (the expected end of step 25), worked out from each step's length, a doer's new dates and its inputs |
| **Gateway** | The part of the backend that talks to a model provider (Anthropic; Copilot on one laptop for now) through one interface, and applies COAL's tools, budgets and logging the same way for each |
| **Go** | The VP's signed decision that creates a project and opens steps 1, 2 and 2a |
| **Health** | Green, amber or red, for a step or project, from its dates ([dashboard.md](./dashboard.md#health)) |
| **Iteration** | One pass through a step. Sending work back opens a new iteration; earlier ones stay on record |
| **Milestone** | A recorded fact that can open a step, such as "material received" or "trial surgeries complete" |
| **Outside document** | A file from outside Jayon (a lab report, a vendor PDF). Treated with extra care by the AI |
| **Passkey** | The standard behind Face ID, fingerprint and Windows Hello sign-in. COAL will use passkeys for signing, in the last block (D16) |
| **Placeholder** | A `{name}` in a template's Word file, replaced when a document is made. Each must match the template's specification |
| **Process run** | One run of a process's route. For R&D, each project has one run |
| **Project** | One product idea going through R&D, from Go to launch. It has one process run |
| **Project team** | The people on a project, named in its PID (step 1) |
| **Proposal** | One or more actions with a preview of their effects, waiting for the user to confirm. The AI creates proposals for anything that affects other people |
| **Queue** | Where a task waits when no one person is assigned. Anyone with the role can claim it |
| **Request** | A task asked of someone you can't assign work to ([the ladder](./roles-and-access.md#assigning-work-and-making-requests)). They can accept or decline it, with a reason |
| **Route** | A process's steps, who does and signs each one, and how work moves. Stored as a versioned definition. Jayon's R&D route has 28 steps |
| **Send back** | Returning work to an earlier step after a failure or a rejected checkpoint |
| **Sign-off** | The signature that completes a step, given by the step's signer |
| **Signature row** | One of the signatures a document needs, in order: Prepared, Reviewed, Approved |
| **Signing intent** | What exactly a person signs: the record and version, its hashes, the meaning, any decision and a one-time challenge |
| **Stage** | One of the six groups of steps: idea and go-ahead; plan, design and source; make the prototype; test and gather feedback; clinical trials; release and launch |
| **Status** | Where a project stands: its stage, step states, owners, dates and health. Visible to everyone (compare *content*) |
| **Step** | One step of the route: C, 1 to 23, 2a, 24a, 24b and 25 |
| **Specification** | The part of a template that says which sections are fields and which are written, where each field comes from, and the signature rows |
| **Step sign-off record** | A record COAL generates when a step is submitted, listing its outputs and their hashes. The signer signs it by approving the step |
| **Task** | One person's piece of work. Kinds: work, review, sign, decision, corrective action, request, own |
| **Template library** | Where COAL keeps the template for each document type, with its versions (draft, active, retired). One version per type is active, and the AI uses it every time |
| **Via AI** | The mark on every request the AI makes on a user's behalf. The backend uses it to apply the AI tiers |
| **Widget** | A Dashboard card that expands into a full view. Defined in `shared/`; every widget returns counts and rows in one shape |
| **Work message** | A notification written from the route's template for the event, for example "Your part on SPN-26-004: step 1…". Never carries comments or reasons |
| **Working day** | Monday to Friday, except the holidays and worked Saturdays in the working calendar |
| **Workstation** | Each person's chat page, organised by project, where they work with the AI |

## Abbreviations

| Short | Stands for | In plain words |
|---|---|---|
| AEMS | Advanced Engineering and Materials Science | Jayon's FEA and metallurgy experts |
| CDSCO | Central Drugs Standard Control Organisation | India's medical device regulator |
| CE | Conformité Européenne | The mark that allows sale in the EU |
| CTRI | Clinical Trials Registry – India | Where Indian clinical trials must be registered |
| DARD | Design Assurance and Regulatory Documentation | Jayon's design assurance and regulatory team |
| DSC | Digital Signature Certificate | A government-recognised digital signature in India, usually on a USB token |
| ERP | Enterprise Resource Planning | Jayon's business system for items, stock and purchasing |
| FDA | US Food and Drug Administration | The US regulator |
| FEA | Finite Element Analysis | A computer stress analysis of a 3D model |
| IFU | Instructions for Use | The leaflet that goes with the product |
| KOL | Key Opinion Leader | A leading surgeon whose feedback counts |
| MD | Managing Director | Signs Board approvals with the CEO |
| MDR | Medical Devices Rules 2017 (India), or Medical Device Regulation (EU) | The device law in each market |
| MIS | Material Issue Slip | The record of material issued to a job |
| NCI | Non-Conformity Investigation | The QA form on which the design revision at step 21 is recorded |
| OEE | Overall Equipment Effectiveness | How much of a machine's time makes good parts |
| PDM | Product Data Management | A vault that controls CAD files and their revisions |
| PID | Project Initiation Document | The document that starts a project and names the team (step 1) |
| PMCF | Post-Market Clinical Follow-up | The EU's follow-up after CE marking. The workflow also uses it for the step-20 follow-up |
| PME | Prototype Manufacturing and Engineering | Jayon's prototype makers |
| QA | Quality Assurance | The company QA team, outside R&D |
| QC | Quality Control | QC inspectors (inside R&D, part of DARD) or the Quality Control department (outside R&D) |
| SSE | Server-Sent Events | How the backend pushes live updates to the website |
| TRF | Test Request Form | The test lab's own request form (step 13) |
| UDI | Unique Device Identification | The identifiers the EU and FDA require on device labels |
