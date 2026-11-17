# COAL: comparing Sharath's and Madhav's plans

**For:** Sharath and Madhav, to discuss before writing one combined plan.
**Date:** 17 November 2026

**The plans compared**

- **Sharath's plan**: two documents, [S1: base layer](./01-base-layer-plan.md) and [S2: AI layer](./02-ai-layer-plan.md), 16 November 2026 (commit `c2cfdf7`).
- **Madhav's plan**: [M: PLAN.md](../PLAN.md), draft 2, 16 November 2026 (commit `2950fb5`).

References such as "S1 §7.2" or "M §3.2" point to sections in those documents. "M step 10" means step 10 in Madhav's step-by-step section (M §4.3).

**A note on bias.** This comparison was written by the AI assistant that wrote Sharath's two documents with him. I've tried to judge both plans on merit. In many areas Madhav's plan is the stronger one, and this document says so. Every recommendation here is an opinion for the two of you to accept or reject.

**Labels used below**

| Label | Meaning |
|---|---|
| **Adopt** | Take it into the combined plan |
| **Merge** | Combine both versions |
| **Discuss** | A real choice for the two of you |
| **Ask Jayon** | Only Jayon can answer it |
| **Later** | Keep it, but in a later phase |
| **Drop** | Leave it out |

---

## 1. The short version

- **Madhav's plan is the stronger base.** It goes much deeper on the domain: Indian law and CDSCO, clinical trials, signatures that hold up in an audit, permissions, SolidWorks, the shop floor, hosting, costs, the team and the risks. It makes firm recommendations and reads like a plan Jayon could approve.
- **Sharath's plan is stronger on the product surface and on the contracts between the parts.** It covers:
  - the Dashboard as widgets that expand when clicked;
  - the full list of APIs and events, which a separate website, app and backend need;
  - one "preview, then confirm" mechanism for anything that affects other people;
  - simple rules for what the AI may do without asking;
  - managers handing work to their teams through the AI.
- **The two agree on the fundamentals:**
  - two pages per person;
  - the route stored as versioned data and run by a small engine of COAL's own;
  - people sign, and the AI only prepares;
  - facts come from records, never from the AI;
  - the AI acts as the person and sees only what they may see;
  - PostgreSQL, TypeScript and Next.js, hosted in India.

**Suggested way to combine them.** Use Madhav's PLAN.md as the backbone: its structure, regulatory work, security, signatures, costs, phases and risks. Fold in from Sharath's plan:

- the Dashboard widgets;
- the APIs and events;
- the preview-and-confirm mechanism;
- the AI action tiers;
- assigning work down the reporting line;
- the Workstation interaction ideas.

Then settle the conflicts in section 6.

**The ten decisions that shape everything else**

1. **Architecture:** one Next.js app (Madhav), or a separate backend, website and mobile app with shared code (Sharath; already the repo layout). See 6.1.
2. **Phones:** the web app installed on phones (Madhav), or a native app (Sharath). See 6.2.
3. **AI provider:** OpenAI first, with an India route for sensitive data (Madhav), or Astra or Claude 5.5 (Sharath). See 6.3.
4. **When the AI arrives:** in the first release (Sharath), or after a foundation without AI (Madhav). See 6.4.
5. **AI runs:** start on their own when a task opens (Madhav), or only when asked or opted in (Sharath). See 6.5.
6. **Signing:** passkeys with Face ID or fingerprint and sealed PDFs (Madhav), or a password and a one-time code (Sharath). See 6.6.
7. **Sign-in and permission infrastructure:** Keycloak and Cerbos (Sharath), or company sign-in, passkeys, one permission module and database row security (Madhav). See 6.7.
8. **Visibility:** can people see the status of projects they aren't on? See 6.8.
9. **The Dashboard:** expandable widgets (Sharath), panels per role (Madhav), or both merged. See 6.9.
10. **Jayon's workflow:** whether to add the records regulators expect, such as design reviews, risk management and clinical approvals. Madhav adds them; Jayon must agree. See section 8.

---

## 2. The two plans at a glance

| | Sharath's plan | Madhav's plan |
|---|---|---|
| Shape | Two engineering specs (base layer, AI layer), about 2,100 lines | One plain-language plan with appendices, about 1,900 lines |
| Written for | The build team | Jayon, the founders and the build team |
| Built from | The workflow page | The workflow page, nine research reports and eight reviews (the reports aren't in the repo; see section 10) |
| AI model | Astra or Claude 5.5, behind a gateway | OpenAI first, with an India-processed route through Amazon Bedrock |
| Architecture | A separate API (NestJS), web app, AI agent service and tool server | One Next.js app plus worker containers |
| Phones | Responsive web, plus the new `app/` folder for a native app | The web app installed on phones (PWA); a kiosk mode on shop-floor tablets |
| Sign-in | Keycloak in front of Microsoft or Google | Company Microsoft or Google sign-in; Amazon Cognito for outsiders |
| Signing | Password and one-time code, with a signature page on the PDF | Passkeys every time, sealed PDFs, and Aadhaar eSign or DSC where Indian law needs it |
| Permissions | Cerbos policy engine | One permission module plus PostgreSQL row-level security |
| Dashboard | 26 widgets that expand, role layouts, Ask AI on each | Three questions (what needs me now, what's coming, how are we doing), panels per role, productivity measures |
| Workstation | Chat threads, action cards, a drafting canvas, skills, a proposals inbox | Project spaces; each task's AI run starts on its own with a live checklist; a preview with the Sign button |
| AI safety | Delegated identity, a permission ceiling, four action tiers, confirmation checked on the server | Acts as the person, a playbook per step, a no-tools reader for outside documents, routing by data label, red-team tests with canaries |
| Database | About 115 tables | About 165 tables in 13 areas, each with its build phase |
| APIs | A full REST catalogue, events and live updates | Not listed |
| Regulation | ISO 13485 mapping and Part 11 aims | CDSCO and the Medical Devices Rules, IT Act, DPDP Act, CERT-In, EU MDR, FDA, ISO 14971 |
| CAD | Upload files; a SolidWorks add-in later | A full SolidWorks connector design in three versions |
| Shop floor | Tables and widgets | Offline kiosk tablets, machine connections, costing formulas, OEE |
| Running cost | Not covered | About ₹66,000 to ₹77,000 a month before GST, excluding AI usage |
| Timeline | Not covered | First real project about 5 to 6 months after Phase 0 starts |
| Team | Not covered | 3 to 4 developers, a C# developer, a validation engineer |
| Risks | AI threats only | A full risk register |
| Open questions | 30 in S1, 15 in S2 | 30, plus 12 decisions to confirm |

---

## 3. What both plans agree on (keep as is)

**Product**

- Two pages per person: the Dashboard and the Workstation (S1 §1, M §3).
- The VP describes the idea in chat, sees each person's responsibilities as boxes and says Go. The engine, not the AI, decides who gets what, and steps 1, 2 and 2a open (S2 §11.1, M §4.1).
- Each person gets a work message written for their part, generated with the recipient's own permissions (S2 §11.6, M §4.1).
- Photos from a phone, and sources, can be added at any step (S1 §5.6, M §3.3, §5.4).
- Review meeting (step 12):
  - minutes in English and Malayalam;
  - action items become tasks;
  - the decisions stay with the R&D Head.

  (S2 §11.5, M step 12.)

**The route**

- The route is versioned data, and each project stays on the version it started with (S1 §4.10, M §4.2).
- COAL runs its own small engine on PostgreSQL with the pg-boss job queue, rather than Camunda or Temporal (S1 §4.11, M §8.2).
- Rework opens a new iteration of a step; history is never edited (S1 §4.6, M §4.5).
- Checkpoints 4, 12, 18 and 23 block everything after them. Both plans assume the MD and the CEO both sign for the Board.
- Step 15 always opens: either the study or a signed justification (S1 §4.7, M step 15).
- Milestones and counts start steps:
  - material received;
  - trial surgeries done, which opens step 21;
  - about 50 positive cases, which opens step 24a.
- A CDSCO test licence is needed before prototypes are made (S1 §4.7, M step 10).
- The Action Plan's dates for each role become the baseline. Alerts fire on missed dates, and deviations record the reason and the cause (S1 §4.9, M §4.4).

**Documents and signatures**

- Documents are made from Jayon's own Word boilerplates, filled by docxtemplater and turned into PDFs by Gotenberg. Fields come from records, never from the AI. The AI writes only the narrative sections, with citations (S2 §12, M §5.3).
- Signing (S1 §5.4, M §7.2):
  - Prepared, Reviewed and Approved rows;
  - a fresh confirmation for every signature;
  - each signature bound to the hash of the exact version;
  - nothing editable afterwards;
  - whoever prepared a document can't also approve it;
  - designed for FDA's Part 11.
- An append-only audit trail, chained by hashes, with a daily anchor in write-once storage (S1 §13.3, M §7.2).

**AI and security**

- The AI acts as the person it works for, never as a shared account, and sees only what that person may see (S2 §2, M §6.1).
- Search is filtered by permission before anything reaches the model (S2 §9.3, M §6.1).
- The AI never signs, approves or sends anything outside Jayon. Messages to colleagues need the person's approval (S2 §7.3, M §5.2).
- Facts come from records with a link to the source, and "I don't know" is an acceptable answer (S2 §12, M §5.7).
- Models, budgets and tests (S2 §14, §17, M §5.8, §6.4):
  - a provider-neutral model gateway;
  - a small model and a strong model;
  - budgets per person and per run;
  - evaluation and red-team tests on every change.
- Outside documents are treated as untrusted. The two plans defend against them differently (see 4.1).
- Patient data is coded and never goes to the AI (S2 §7.7, M §5.8).

**Technology**

- TypeScript, Next.js, Tailwind and shadcn/ui.
- PostgreSQL with pgvector, and S3 with write-once locking.
- Hosting in India.
- An `org_id` on every table, so COAL could serve other companies later.

(S1 §12, M §8, §9.)

---

## 4. Same topic, different depth: pick the stronger version

### 4.1 Where Madhav's version is stronger

Suggestion for every row: **adopt Madhav's version**, keeping anything from Sharath's plan that the row mentions.

| Topic | Sharath's plan | Madhav's plan | Why Madhav's is better |
|---|---|---|---|
| **Signing** | Password and one-time code, or a fresh sign-in through SSO; a signature page on the PDF (S1 §5.4) | Passkeys for every signature (Face ID, fingerprint, Windows Hello or PIN). Final PDFs are sealed with the company certificate and an Indian timestamp. Everyone has an identity check, signs an e-signature agreement and is trained before they can sign (M §7.2, §7.3) | Easier for people, with no passwords to keep, and documented against Part 11. Only the person's own device can sign, so the AI provably can't |
| **Indian law on signatures and records** | Not covered | The IT Act: where a law demands a signature, only a DSC or Aadhaar eSign counts electronically. The Medical Devices Rules: records must be printable, typed critical data checked by a second person, and versions carry effective dates. Also an Indian legal opinion, and the FDA letter (M §7.1, §7.4) | Decides whether COAL's records hold up in India |
| **Permission model** | A classification per record, the Cerbos policy engine, and a 7-column matrix (S1 §6) | Data labels: a level, plus compartments such as finance, Board, clinical and HR. Sections of mixed documents get their own labels. A 30-row clearance matrix, with PostgreSQL row-level security as a backstop (M §6.1, §6.2) | Far more complete, and the database catches bugs in the code |
| **Leak paths** | A search filter and a write-down check (S2 §7.2, §9.3) | A table of the ways data escapes: search, summaries, messages, outside documents, old chats, notifications, Dashboards, small numbers and clinical files. Also covers privileged access, people who leave and lost phones (M §6.1) | Covers how leaks actually happen |
| **Outside documents** | Tagged as untrusted; once one is read, the AI can't write without confirmation (S2 §7.6) | A separate AI step with no tools reads them into a fixed form, which a person confirms. While raw outside text is in a chat, the AI can't send messages, and links and images in its answers aren't shown (M §6.1) | A defence built into the design, in line with current guidance on prompt injection |
| **Red-team tests** | Safety cases in the evaluation suite (S2 §17) | Attacks role by role in a made-up company. Canary values must never reach the AI, and other checks make sure the AI isn't too cautious (M §6.4) | Canaries give a hard pass or fail for leaks |
| **AI and data in India** | Enterprise terms and zero retention; where data is processed is left open (S2 §14, AQ1) | Each request is routed by its data labels. Costs, CAD numbers, Board papers and clinical data go only to models processed in India, and the same applies to search indexing and transcription (M §5.8) | Turns "data stays in India" into a rule the gateway enforces |
| **How the AI works on a step** | A skills library and optional pre-drafting (S2 §10.3, §13) | A versioned playbook for each step: mandatory checklist items, data to fetch, allowed tools and approval points, approved with each process version. The AI can add items but not skip mandatory ones (M §5.1) | Predictable and auditable, and limits what injected instructions can do |
| **Long-running AI work** | Background jobs with limits (S2 §10.5) | Each run is a database row with an event log, carried out by workers, so the browser can reconnect to it. Every tool call has a retry key, and waiting for a person ends the job (M §5.1) | Survives closed laptops, restarts and retries |
| **Keeping numbers honest** | Fact fields come from records, with citations (S2 §12) | The same, plus: tables are shown straight from stored results, a check blocks any number not found in a source, and a second model reviews drafts that will be signed (M §5.7) | Stops misquoted numbers in signed documents |
| **Research** | Web search for the market study, if allowed (S2 AQ5) | A separate research assistant with no access to internal data. It searches free public databases first (openFDA, GUDID, PubMed, ClinicalTrials.gov, patents) and uses general search terms, so Jayon's plans don't leak (M §5.4) | Better sources, and no leak risk |
| **SolidWorks** | Upload files; PDM sync and an add-in later (S1 §11, S2 AQ7) | A connector on each designer's PC that only connects outwards, built in three versions: read and export, FEA help, then approved changes. Lists what the AI must never do in CAD and the licence findings (no SolidWorks on cloud servers). Approvals are tied to file hashes (M §5.5) | Buildable, respects the licence, and sets realistic expectations of "AI in CAD" |
| **Shop floor and costing** | Tables and widgets (S1 §9.4 E) | A staged plan from tablets to machine sensors. Offline kiosk tablets with a badge and PIN. Costing formulas in line with Indian accounting standards, using average rates per grade so nobody's pay shows. Frozen cost sheets, the OEE formula and a calibration lock (M §5.6) | Ready to build, and fair to people |
| **ERP** | Reference numbers typed in, with a sync later (S1 §11) | A small agent on Jayon's network that only connects outwards. Read-only first, with write-back only after two clean months (M §5.6, §8.1) | Safe and realistic |
| **Deadlines and deviations** | Alert thresholds; deviations with a category and a cause (S1 §4.9) | A concrete escalation ladder. The line manager confirms each deviation, and the person named can reply. A late task can't close without its record, and one rule decides who sees the named cause (M §4.4) | Fairer, and enforced |
| **Rework** | A preview of the impact; the person deciding marks what carries over (S1 §4.6) | Resets only the steps that depend on the reopened one, and never resets patient follow-up. Open AI runs are cancelled, and the Lead re-plans the dates (M §4.5) | Correct by default. Keep Sharath's preview on top |
| **Changing the process** | New versions for new projects; moving running projects comes later (S1 §4.11) | An impact report for every running project, a validation impact assessment, signatures from the R&D Head and QA, and migration with a step mapping (M §4.5) | What ISO 13485 change control requires |
| **Records auditors look for** | A table mapping ISO 13485 clauses (S1 §13.2) | Design inputs, traceability, design reviews including a design freeze, design change records, the risk management plan and report, a standards register, UDI, 15-year retention and the design file index (M §7.7) | Practical and complete |
| **Clinical trials** | Follow-ups; patient identifiers kept in a locked vault (S1 §9.4 E) | The clinical route is decided per device. Step 20 opens at a hospital only once its approvals are recorded: CDSCO, ethics committee, CTRI, consent and insurance. Adverse-event deadlines are tracked, and patients are never named in COAL (M steps 19 and 20) | Removes a serious legal risk, with better privacy |
| **Validating COAL itself** | A validation pack if COAL becomes the official record (S1 Q6) | Risk-based validation following FDA's guidance. Paper stays the official record until the validation report is signed (M §7.6) | A clear, safe path to go-live |
| **Hosting and operations** | An India region and daily backups (S1 §12.4) | AWS Mumbai with recovery copies in Hyderabad. Recovery targets, restore drills, a rule for when to move to high availability, and error tracking kept in India (M §8.6, §10) | Ready to run |
| **Productivity** | A team workload widget (S1 §7.3, W11) | Measures the flow of work, not activity: on-time rate against the first date given, days per task against plan, sign-off turnaround, rework rate and open load. Reasons are attached, with clear rules on who sees whose numbers. Madhav notes the COAL meeting asked for this (M §3.2) | Meets a stated requirement, fairly |
| **Signature meanings** | Prepared, Reviewed and Approved, on documents (S1 §5.4) | Also Verified, Received and accepted, Attended, Trained, and decisions. Any record can need a signature, such as process versions, cost sheets and Material Issue Slips (M Appendix D, area E) | Covers QC checks, handovers and change control |
| **What "BP" means** | An open question (S1 Q20) | Reads it as "boilerplate" (M Part 2), which fits every use in the workflow | Settles the question (confirm with Jayon) |

### 4.2 Where Sharath's version is stronger

Suggestion for every row: **adopt Sharath's version**, keeping anything from Madhav's plan that the row mentions.

| Topic | Madhav's plan | Sharath's plan | Why Sharath's is better |
|---|---|---|---|
| **The Dashboard** (Sharath's original ask: boxes that expand when clicked) | Panels per role in three groups, with nothing about expanding (M §3.2) | A widget framework: each compact card opens into a large view with tabs, filters, actions and its own link. Live refresh, personal layouts and default layouts per role, with Ask AI on every widget. 26 widgets, split into the first release and later (S1 §7.2 to §7.4) | It's what was asked for, specified well enough to build |
| **Drill-down views** | Project spaces in the Workstation; a six-stage strip on the Dashboard | A project page showing the live route (step states, iterations, overdue markers), a step panel and a document viewer (S1 §7.5) | One place for a manager to see a whole project |
| **Portfolio metrics and health** | Productivity per person; health as on track, at risk or late | Defined metrics: cycle time per stage, signature wait, rework by cause, first-pass yield, budget use, regulatory readiness and follow-ups on time. Rules for red, amber and green (S1 §7.6, §7.7) | Complements Madhav's productivity measures |
| **APIs** | "COAL's own APIs", not listed | OpenAPI as the contract, with the full endpoint list: retry keys, version checks, standard errors and paging. Each endpoint states its permission and its AI tier (S1 §10) | Needed now that the website, app and backend are separate folders, and for the AI's tools |
| **Events and live updates** | Follow-up jobs queued in the same transaction; a live checklist stream | A catalogue of domain events that feed notifications, live widget refresh, AI triggers, search indexing and analytics. One live stream per user (S1 §10.4, §10.5) | One mechanism for everything that reacts to a change |
| **Previewing and confirming actions** | Runs pause for approval; messages need their exact text approved; Go is a signed decision (M §5.1, §4.1) | Every workflow action can be previewed. Actions that affect others become a versioned proposal showing exactly what will happen, which only the person can confirm, from their own session. The UI uses the same mechanism for bulk actions (S1 §10.3, S2 §7.4) | One general mechanism for people and the AI. It's how the VP's boxes work |
| **What the AI may do on its own** | Tool groups with limits, and a "never" list (M §5.2) | Every endpoint declares one of four tiers: read; auto (only the person's own drafts); confirm (anything that affects others); human only (signing and decisions) (S2 §7.3) | Easy to explain, test and audit. A new endpoint can't forget its tier |
| **Managers giving work through the AI** (Sharath's original ask) | Questions to colleagues on the same project (M §5.2) | Managers assign work down their reporting line; anyone else gets a request they can accept or decline. "Ask Anil to rerun the FEA by Friday" becomes a confirmed task (S1 §6.4, S2 §11.2) | Directly covers the VP or R&D Head giving work to the people below them |
| **Who gets a task** | The default person for each role (M §4.1) | The person named on the project first, then the role holder for the product line, then a queue anyone in the role can claim (S1 §4.8) | Nothing gets lost when a role is empty or someone is away |
| **Workstation interactions** | Three panes: the Docket and project spaces, the conversation, and the preview (M §3.3) | Context chips, @mentions, /commands, a skills library, action cards, a canvas for drafting section by section, a proposals inbox, an activity trail, voice input, and English or Malayalam (S2 §5) | Ideas to add to Madhav's layout |
| **Everyday AI help** | A playbook for each step, plus answering questions | "Why is this late?", a daily briefing, a signing brief ("what am I signing?") and the Board pack (S2 §10.3, §11.6, §11.7) | Useful to every role every day, not only at their own steps |
| **Explaining the AI permission model** | Stated as a rule (M §6.1) | Why the agent works as the person rather than the role, the four refinements, and the options rejected (S2 §2) | Helps explain the security model to Jayon |
| **Steps with no named document** (6 and 9), and checkpoints | "Follow the same pattern once their documents are defined" (M §7.5) | A Step Completion Record, generated and signed at each sign-off. It lists every output with its hash, and the decision (S1 §4.5) | Every sign-off has something concrete to sign |
| **The route, for developers** | Points to the workflow page on claude.ai | A route diagram, a step state machine, and an example process definition in YAML (S1 §4.2, §4.3, §4.10) | Developers can start from it |
| **Forecasting** | Mentions a forecast "moving past the plan" | A critical-path forecast, recalculated after every change and each night (S1 §4.9) | Flags a step as at risk before its date is missed |
| **Repository layout** | One Next.js app | `web/`, `app/`, `backend/` and `shared/`, with rules on what may import what (S1 §12.3; already pushed) | Matches the decision to build a website and an app |

---

## 5. Only in one plan

### 5.1 Only in Madhav's plan

**Business and delivery**

| Item | Why it matters | Suggestion |
|---|---|---|
| Running and one-time costs: hosting, licences, eSign, seals, tablets and security keys (M Part 10) | Jayon will ask what COAL costs | Adopt; re-check prices before quoting |
| Build or buy: a hybrid recommendation, and a 2-to-4-week trial of two commercial quality systems as a benchmark (M §8.4) | A real alternative Jayon's QA may raise | Discuss (6.13) |
| The team: roles, time and who does what (M Part 11) | Needed to staff and budget the build | Adopt |
| Phase durations, and a date for the first real project (M Part 11) | Jayon will want dates | Discuss how firm to make them |
| Phase 0, "gather and decide", with clear done criteria (M Part 11) | Nothing useful can be built before Jayon's inputs arrive | Adopt |
| A risk register, with the response to each risk (M Part 12) | Shows Jayon the risks are handled | Adopt, and add Sharath's AI threats (S2 §7.6) |
| Decisions for Jayon to confirm, each with a recommendation (M §13.1) | Quicker for Jayon to answer than open questions | Adopt |
| A glossary and a list of abbreviations (M Part 2, Appendix B) | The first stop for Jayon and new team members | Adopt |

**Product and screens**

| Item | Why it matters | Suggestion |
|---|---|---|
| "Docket" as the name for the to-do list (M §3.1) | Naming | Discuss (low stakes) |
| A "Coming up" list of tasks that will open later, with expected dates. Every project member gets a project space from the moment of Go (M §3.2, §3.3) | People see their part long before it starts | Adopt |
| AI runs that start when a task opens, with a live checklist like Claude Code; the draft is waiting when the person arrives (M §3.3, §5.1) | The biggest time-saver in either plan | Adopt (6.5) |
| A preview pane with the Sign button, so reviewing and signing happen together (M §3.3) | Fewer clicks | Adopt |
| Health worked out from dates only, for people who can't see the budget (M §3.2) | Health can't hint at budget problems | Adopt |
| Single-use links for surgeons' surveys; invited accounts for labs and outside makers that expire (M §8.5) | A cheap way to get outside input early | Adopt the links; Ask Jayon about accounts (M question 25) |
| A kiosk view on shop-floor tablets, with no Dashboard, chat or AI (M §3.5, §5.6) | Fast and safe data entry on the floor | Adopt |

**Security and privacy**

| Item | Why it matters | Suggestion |
|---|---|---|
| Refusals: "not found" for things a person shouldn't know exist; "restricted", with who to ask, for things they know exist (M §6.3) | People understand refusals, and nothing leaks | Adopt |
| WhatsApp and phone alerts never show a project code, product, step or name (M §6.1) | Phone alerts are seen by others | Adopt |
| Clinical figures about fewer than five patients are hidden, and yes-or-no questions about restricted values are refused (M §6.1) | Prevents working out the answer indirectly | Adopt |
| An access log of every download, export and print, and every view of a restricted record. Printed copies are watermarked "Uncontrolled copy" (M §6.1, §9.1) | Shows who took what | Adopt |
| The audit and AI logs store references and hashes, not content, and keep content encrypted (M §6.4) | The log doesn't become a second copy of every secret | Adopt |
| Emergency access needs two approvers; developers can't see production data; test environments use made-up data (M §6.1) | Protects against insiders | Adopt |
| People who leave are switched off within a working day; one action revokes a lost phone (M §6.1) | A common real-world leak | Adopt |
| Board and release signers use security keys that can't be copied to other devices (M §7.3) | The strongest signatures where they matter most | Adopt |
| Signature cover during leave, with limits: named projects and dates, Board signatures can't be covered, and "signed on behalf of" is printed (M §6.1) | Work doesn't stall during leave | Adopt (Sharath's plan has a lighter version that waits on Jayon's answer, S1 §5.4, Q12) |
| Uploads are quarantined and scanned, Office macros removed, and SVG or HTML files never shown directly (M §8.6) | Uploads are a common way in for attackers | Adopt |
| Error reports scrubbed and kept in India, using self-hosted GlitchTip (M §8.1) | Error tools often capture real data | Adopt |

**Compliance and regulation**

| Item | Why it matters | Suggestion |
|---|---|---|
| CERT-In: report incidents within 6 hours, keep logs for 180 days in India, check clocks against Indian time servers (M §7.1, §8.6) | A legal duty in India | Adopt |
| DPDP Act: notices, contracts with processors, a breach procedure, logs kept a year (M §7.1) | A legal duty from about 2027 | Adopt |
| A test licence ledger: units made, tested, stocked and disposed of. Each run card checks the licence's validity and remaining quantity (M step 10) | The Medical Devices Rules require it | Adopt |
| The clinical route per device, and approvals per hospital before step 20 opens there: CDSCO, ethics committee, CTRI, consent and insurance (M steps 19 and 20) | Stops trial surgeries without permission | Adopt; Ask Jayon (M question 13) |
| Reporting deadlines for serious adverse events: 48 hours and 14 days (M step 20) | Legal deadlines | Adopt |
| At step 17: UDI, the implant card, the safety and performance summary, labelling checks per market, and DARD's review (M step 17) | Needed for CE and FDA | Ask Jayon (adds work to step 17) |
| Design inputs, traceability, design reviews (including a design freeze), design change records, and the risk management plan and report (M §7.7) | What auditors check first | Ask Jayon (adds records to the workflow; see section 8) |
| A standards register that alerts when a cited edition is replaced (M §7.7) | Keeps documents current | Later |
| The text of purchased ISO and ASTM standards is kept out of the AI (M §5.3) | Their licences forbid it | Adopt |
| The FDA letter, an e-signature agreement, an identity check, and training before anyone signs (M §7.2) | Part 11 requirements | Adopt |
| Paper stays the official record during the pilot, until COAL's validation report is signed (M §7.6, Phase 4) | A safe go-live | Adopt |

**Documents**

| Item | Why it matters | Suggestion |
|---|---|---|
| Drafts are numbered while being edited; the revision letter is given only at approval (M §5.3) | A clean revision history | Adopt |
| A Word copy with tracked changes for the record; PDF/A; each boilerplate checked visually against Word (M §5.3) | Auditors and users expect Word redlines | Adopt |
| A register of boilerplates, with the phase each is built in (M §5.3) | Plans the template work | Adopt |
| Controlled copies, and training records when a document gets a new revision (M Appendix D, areas A and E) | ISO 13485 document control | Adopt |

**Operations and data collection**

| Item | Why it matters | Suggestion |
|---|---|---|
| A spreadsheet to collect Jayon's machines, software, instruments and rates (M Appendix C) | Can go to Jayon today | Adopt; send it now |
| Backups, recovery targets, restore drills, and when to move to high availability (M §8.6, §10.2) | Running COAL safely | Adopt |
| Sarvam first for Malayalam transcription; recordings deleted once the minutes are signed (M §8.1, step 12) | Malayalam support decides the choice | Adopt, after testing |
| A status pack for each attendee of the review meeting, built from what they may see (M step 12) | Saves preparation time | Adopt |
| At launch, a handover to QA for post-market work, and lessons learned (M step 25) | Closes the loop | Adopt |

### 5.2 Only in Sharath's plan (good-to-haves to carry over)

| Item | Why it matters | Suggestion |
|---|---|---|
| Filters for product line and project across the whole Dashboard, and one search box (Cmd-K) for projects, documents, tasks and people (S1 §7.1) | Fast to find anything | Adopt |
| Personal Dashboard layouts and saved filters (S1 §7.2, §9.4 F) | People shape their own view | Later |
| A daily email digest (S1 §8) | Busy people read email first | Adopt |
| A "waiting" state on tasks, with the reason, and requests the other person can decline (S1 §4.8) | Shows who is blocked and why | Adopt |
| One AI runtime with a role profile per person, and the prompt built in layers: platform, company, role, person, context, retrieved data (S2 §10.1, §10.2) | Simpler than a separate bot per role; fits Madhav's playbooks | Adopt |
| The AI's tools served over MCP, generated from the API spec (S2 §8) | Other clients, such as the SolidWorks connector or the app, can reuse the same tools | Discuss (Madhav uses MCP only for the CAD gateway) |
| A write-down check on everything the AI writes, not just messages: content can't move to a lower label without confirmation (S2 §7.2) | Closes a leak through comments and drafts | Merge with Madhav's label rules (M §6.1) |
| Measures of whether the AI helps: share of proposals confirmed, how much drafts change before approval, time to the first draft (S2 §17) | Shows whether the AI is earning its cost | Adopt |
| Suggested next actions in the Workstation, such as "Your PID is due Friday. Shall I draft it?" (S2 §5.2) | A nudge without nagging | Adopt |
| A memory the person can see and edit (S2 §10.4) | Personal preferences | Later |
| Sharing a Workstation chat, re-checked against the recipient's access (S2 AQ15) | Collaboration | Later |
| QC reports from a photo or CSV of a measurement sheet; run-card logging by photo or voice (S2 §4.3) | Less typing | Discuss (Madhav reads instruments directly and keeps the AI off the kiosk) |
| Worked examples: the concept card and preview results as JSON, and template and process definitions as YAML (S2 §11.1, §12; S1 §4.10) | Developers can start from them | Adopt, as appendices |
| A check that every "Planned" item on the workflow page is covered (S1 §15) | Proves nothing was missed | Adopt, for the combined plan |
| Whether COAL is built only for Jayon or as a product for other companies (S1 Q1) | Affects data separation between companies, ownership, hosting accounts and pricing | Discuss (see section 10) |

---

## 6. Conflicts to decide

Each item gives both positions, the trade-off, and a suggestion.

### 6.1 Architecture: one app, or separate parts?

- **Sharath:** separate folders for `backend/` (API, workers, AI agent, tool server), `web/`, `app/` and `shared/`. This is already the repo layout.
- **Madhav:** one Next.js app that serves the screens and the APIs, plus worker containers built from the same code.
- **Trade-off:** one app is simpler to build, deploy and validate. Separate parts keep the API contract explicit and suit a second client, such as a mobile app.
- **Suggestion:** keep the four folders and fit Madhav's design into them:
  - `backend/`: the API, the workers, the AI runs, and the document and signing services;
  - `web/`: the screens;
  - `shared/`: the types, the process definition and the shared rules.

  Little of Madhav's design changes. **Discuss.**

### 6.2 Phones: web app or native app?

- **Sharath:** a native app in `app/`.
- **Madhav:** the web app installed on phones (a PWA) covers the Docket, questions, photos and passkey signing. Shop-floor tablets run a locked kiosk mode of the same web app.
- **Trade-off:** a PWA is one codebase and updates instantly. A native app is better at:
  - reliable alerts on iPhones;
  - recording meetings in the background;
  - working offline;
  - running on company-managed phones.

  But it's a second front end, distributed through the app stores or device management.
- **Suggestion:** start with the PWA for phones and kiosks. Build the native app when a concrete need appears, such as the meeting recorder or offline problems on the shop floor; `app/` stays ready for it. **Discuss.**

### 6.3 AI provider

- **Sharath:** Astra or Claude 5.5, which Sharath already has access to.
- **Madhav:** OpenAI first. Sensitive data (costs, CAD numbers, Board papers, clinical data) goes only to models processed in India, through Amazon Bedrock in Mumbai or OpenAI's India region.
- **Trade-off:** the models you already have, against keeping sensitive data in India.
- **Suggestion:** this isn't either-or, because both plans put a gateway in front of the models. Madhav's research says Bedrock's India regions also run Anthropic models. If the Claude model you have is available there, it satisfies both plans, so check that first. Jayon sets the data policy. **Discuss; Ask Jayon.**

### 6.4 When the AI arrives

- **Sharath:** a first version of the Workstation AI is built alongside the workflow core.
- **Madhav:** Phase 1 has no AI; the AI comes in Phase 2.
- **Trade-off:** the AI is what sells COAL. Building the foundation first lowers risk, and the AI then works on real data and APIs.
- **Suggestion:** Madhav's order, plus an early demo so Jayon sees the AI from the start: the idea-to-Go flow with the boxes, and answering questions about projects. **Discuss.**

### 6.5 Do AI runs start on their own?

- **Sharath:** background work only for people who opt in; otherwise the AI works when asked.
- **Madhav:** when a task opens, its run starts straight away, acting as that person, so a draft is waiting when they arrive.
- **Trade-off:** starting on their own saves the most time, but spends AI budget on tasks nobody has opened yet.
- **Suggestion:** Madhav's way. Runs only fetch and draft, and nothing reaches anyone else without approval. Add an off switch per person and per project, and keep the budgets. Drop Sharath's opt-in consent. **Adopt Madhav's.**

### 6.6 Signing

- **Sharath:** a password and a one-time code, or a fresh sign-in through company SSO.
- **Madhav:**
  - passkeys every time: Face ID, fingerprint, Windows Hello or PIN;
  - sealed final PDFs;
  - Aadhaar eSign or DSC for the document types an Indian lawyer names.
- **Suggestion:** Madhav's way. It's easier for people, stronger in an audit, and only a person's own device can produce a signature. Build the eSign connection once counsel confirms where it's needed (7.2). **Adopt Madhav's.**

### 6.7 Sign-in and permission infrastructure

- **Sharath:** Keycloak for single sign-on and for the AI's delegated identity, and the Cerbos policy engine.
- **Madhav:**
  - company Microsoft or Google sign-in;
  - passkeys for signing;
  - Amazon Cognito in Mumbai for outsiders;
  - one permission module in the code, plus PostgreSQL row-level security;
  - Cerbos only if the rules grow.
- **Trade-off:** Keycloak and Cerbos are two more services to run and validate for about 60 users. Sharath's token design does give a clear guarantee that the AI can never reach the confirm or sign endpoints.
- **Suggestion:** Madhav's lighter stack, keeping Sharath's guarantee as a rule:
  - every AI call is marked as acting for a person;
  - the confirm and decision endpoints refuse those calls;
  - signing needs a passkey, which only the person's device can give.

  **Discuss.**

### 6.8 Seeing projects you're not on

- **Sharath:** status (stage, owners, dates, blockers) is visible more widely than content. For example, R&D Ops and DARD see the status of every project.
- **Madhav:** need-to-know. To someone outside a project it doesn't exist ("not found"). The Board, the VP and the R&D Head see everything, and Leads see their own product line.
- **Trade-off:** openness helps coordination and explaining delays. Need-to-know protects products that haven't been released.
- **Suggestion:** Madhav's as the default; Jayon decides (M question 22). **Ask Jayon.**

### 6.9 The Dashboard

- **Sharath:** a grid of widgets, where each card expands into a detailed view. Default layouts per role, and Ask AI on every widget.
- **Madhav:** three questions in order (what needs me now, what's coming, how are we doing), with panels that change by role, and productivity measures.
- **Suggestion:** merge them:
  - Madhav's three questions set the default layout and order;
  - each panel becomes one of Sharath's expandable widgets;
  - Madhav's productivity measures become a widget;
  - keep his rule of working out health from dates only for people who can't see the budget.

  **Merge.**

### 6.10 Confirming actions

- **Sharath:** every workflow action can be previewed. Actions that affect others become a versioned proposal, which only the person can confirm, from their own session. The UI and the AI both use it.
- **Madhav:** runs pause for approval, messages need their exact text approved, and Go is a signed decision.
- **Suggestion:** merge them. Sharath's previews and proposals are the mechanism on the server, and Madhav's run pauses are how they appear in the Workstation checklist. Madhav's signed Go stays. **Merge.**

### 6.11 "Delegation" means two different things

- **Sharath:** managers give work to the people below them through the AI ("Ask Anil to rerun the FEA by Friday").
- **Madhav:** someone covers another person's sign-offs during leave.
- **Suggestion:** both are needed. Give them two names in the combined plan, for example **assign** for giving work and **cover** for signing on someone's behalf. **Adopt both.**

### 6.12 Patient identities

- **Sharath:** any identifiers that are kept go in a locked vault behind one service.
- **Madhav:** patients are never named in COAL. The hospital keeps the key that links a case code to a patient.
- **Suggestion:** Madhav's way. There's less to protect, and it's simpler under the DPDP Act. **Adopt Madhav's.**

### 6.13 Build or buy

- **Sharath:** build the R&D system, and don't replace Jayon's quality system outside R&D.
- **Madhav:** the hybrid:
  - build the R&D system of record;
  - keep CAD revisions in SOLIDWORKS PDM, if Jayon adopts it;
  - connect to QA's quality system for corrective actions (CAPA), complaints and audits;
  - benchmark two commercial systems first.
- **Suggestion:** the hybrid is the same idea, made explicit. A short desk comparison is enough, unless Jayon's QA pushes for a commercial system. **Discuss.**

### 6.14 Where step 2a sits

- **Sharath:** assumes regulatory planning must finish before the Action Plan (step 5).
- **Madhav:** step 3 doesn't wait for it; steps 13, 19 and 22 use it.
- **Suggestion:** both are assumptions on the same open question (S1 Q7, M question 1). **Ask Jayon** (Akhil).

### 6.15 The format of the combined plan

- **Sharath:** two engineering specs, with no costs or dates.
- **Madhav:** one plain-language plan with costs, dates, risks and appendices.
- **Suggestion:** one master plan in Madhav's style, for Jayon and the founders. Put the developer detail (APIs, events, widgets, AI tiers, schema) in appendices or a separate engineering spec. **Discuss.**

---

## 7. What I would drop or defer

These are opinions, meant to keep the first release focused.

### 7.1 From Sharath's plan

| Item | Why | Suggestion |
|---|---|---|
| Keycloak, and token exchange for the AI's identity (S2 §7.1) | Extra infrastructure for about 60 users. The same guarantee comes from passkeys plus marking AI calls (6.7) | Drop |
| A password and one-time code for signing (S1 §5.4) | Passkeys replace it | Drop |
| Opting in before background AI work (S2 §7.5) | Gets in the way of runs that start on their own, which only draft anyway | Drop |
| Cerbos as the first choice (S1 §6.1) | Madhav's module plus row-level security does the job with less to run | Later, only if the rules grow |
| A vault for patient identities (S1 §9.4 E) | Never naming patients is safer | Drop |
| All 26 widgets at once (S1 §7.3) | Too many to design well at the start | Keep the framework; build about 8 to 10 widgets first, based on Madhav's role panels |
| Status visible across all projects (S1 §6.1) | Conflicts with need-to-know | Drop, unless Jayon wants it (6.8) |
| No outside logins until a portal (S1 §3.3) | Survey links are cheap and useful now | Drop, in favour of Madhav's links |
| Data analysis by the AI in a sandbox (S2 §19, AI-3) | Nice, but not needed | Later, or drop |
| AI memory and sharing chats (S2 §10.4, AQ15) | Little value early on | Later |
| A separate document for the AI layer | Duplicates the master plan | Merge into one plan |

### 7.2 From Madhav's plan

| Item | Why | Suggestion |
|---|---|---|
| The Aadhaar eSign connection, built in Phase 1 (M Phase 1) | Building it before an Indian lawyer says where it's needed may waste work | Keep a place for it in the design, and build it once counsel confirms. Board approvals are the likely first use |
| Re-stamping seals to the long-term level (M §7.2) | Only matters years later | Later (seal PDFs from day one) |
| A second model reviewing every draft that will be signed (M §5.1, §5.7) | Doubles the AI cost of every document | Keep it for high-risk documents only: labelling and IFU, regulatory submissions, FEA reports |
| A label on each section of every mixed document (M §6.1) | Complex to build everywhere | Use separate annexes by default, as Madhav already does for budgets and costs. Keep section labels for minutes only |
| SOLIDWORKS PDM Professional, about ₹38 lakh for 10 editors (M §8.4, §10.3) | It's Jayon's purchase, not part of building COAL | Keep it as Jayon's option, but don't make COAL depend on it |
| SolidWorks connector versions 2 and 3 (M §5.5) | Large effort; version 1 already gives most of the value | Later, once version 1 has proved itself |
| Automatic machine data from sensors (M §5.6) | Hardware and work on every machine | Later (Madhav already puts it in Phase 5) |
| The trial of commercial quality systems (M §8.4) | Takes weeks of attention | Optional (6.13) |
| About 165 tables | Right for the full system, but heavy for a first release | Keep as the target, and build Madhav's Phase 1 list (M §9.4) first |
| Fixed durations in the plan | Estimates can turn into promises | Keep them, clearly marked as estimates, as Madhav already does |

---

## 8. How the two plans read Jayon's workflow differently

Only steps where the plans differ are listed. "Addition" means Madhav adds something that isn't on Jayon's workflow page. These additions are good regulatory practice, but they change Jayon's process, so Jayon and their QA team must agree to them first.

| Step | Sharath's plan | Madhav's plan | Note |
|---|---|---|---|
| C | Go is a confirmed proposal | Go is a signed decision, made with a passkey | Merge: Go is a signature |
| 2a | Must finish before step 5 (an assumption) | Step 3 doesn't wait for it; steps 13, 19 and 22 use it | Ask Jayon |
| 4 | The decision can be go, rework, hold or drop | The same, plus two questions: what happens if the Board says no (question 18), and are these statutory Board resolutions (question 17) | Adopt Madhav's questions |
| 5 | Action Plan: team, dates, budget and raw material | Adds design inputs, the risk management plan and a separate budget annex. DARD reviews it without the budget | Addition: Ask Jayon |
| 7, 8 | Models and drawings uploaded; critical dimensions listed | Connector checks and hashes of the native files, plus a design freeze review once both steps are signed | Addition (the design freeze): Ask Jayon |
| 10, 11 | The licence gate, the run card and the QC report | Also checks the licence's validity, place and quantity. Typed readings are checked by a second person. A system job builds the cost sheet, and the R&D Head approves it | Adopt Madhav's |
| 12 | Minutes with the decisions | A status pack for each attendee; minutes sections labelled by sensitivity; the recording deleted once the minutes are signed | Adopt Madhav's |
| 13 | R&D Ops and DARD make the first call on a failure | The same. Also: R&D Ops tells the lab to go ahead only after the plan check finds no discrepancy, and the lab report is read by the no-tools reader | Adopt Madhav's detail |
| 14 | Marketing brings the forms back | Surgeons can also answer through single-use links | Adopt |
| 17 | Surgical technique, catalogue and IFU | Adds UDI, the implant card, the safety and performance summary, labelling checks per market, and DARD's review | Addition: Ask Jayon |
| 19 | Trial planning | Adds the clinical route decision (DARD prepares it, company QA approves it), and the application dossier when one is needed | Addition: Ask Jayon (M question 13) |
| 20 | Follow-up milestones; patients pseudonymised | Approvals at each hospital before its first case, consent recorded, and adverse-event deadlines. Rework never resets follow-up. Notes that "PMCF" is the wrong term before CE marking | Adopt; Ask Jayon about the route |
| 21 | The design revision goes on the NCI form | Adds a separate design change record | Addition: Ask Jayon |
| 22 | A submission pack with a check for gaps | Adds the risk management report, and registration in EUDAMED and GUDID | Addition: Ask Jayon |
| 23 | The Board approves the transfer | Can't start until the risk management report is approved; adds a release pack the Board may see | Addition: Ask Jayon |
| 25 | Launch sets; the project closes after follow-up | Adds a handover to QA for post-market work, and lessons learned | Adopt |
| Reviewers | A default rule for who reviews each document (S1 §5.2) | A proposed reviewer for every document (M §7.5) | Adopt Madhav's table as the proposal to Jayon |

---

## 9. Open questions, merged

### 9.1 Asked by both (merge into one question each)

| Topic | Sharath | Madhav |
|---|---|---|
| Where step 2a sits, who does it, who signs it | S1 Q7 | Q1 |
| Board: must both the MD and the CEO sign? | S1 Q8 | Q17 |
| Who can drop a project or put it on hold | S1 Q9 | Q15 |
| Who reviews each document | S1 Q11 | Q16 |
| Must the VP re-approve dates when they move? | S1 Q13 | Q26 |
| Step 13: who signs what, and who decides a failure | S1 Q14 | Q5, Q19 |
| Step 20: how the follow-up runs | S1 Q15 | Q6 |
| Step 21: does a change to the instrument alone go back to step 8 or 10? | S1 Q16 | Q7 |
| Steps 23 to 24b: the transfer documents, who signs 24a, the 50 cases, the QC managers, training | S1 Q17 | Q8 to Q12 |
| The raw material definition after the FEA; DARD's part at step 6; who approves the Material Issue Slip | S1 Q18 | Q2 to Q4 |
| CDSCO test licence: applied for or granted; internal bench prototypes; when QA applies | S1 Q19 | Q14 |
| Who sees what: other product lines, costs, the named cause of a delay | S1 Q5 | Q22, Q24 |
| Outside parties: their own accounts, or documents through R&D Ops | S1 Q27 | Q25 |
| The ERP: which one, where it runs, its APIs | S1 Q22 | Q30 |
| The org chart, IT details, SolidWorks and PDM | S1 Q4, Q23 | M §13.3 |
| Which data the AI may process outside India | S2 AQ1, AQ2 | M §13.1 |
| Recording meetings: consent and how long recordings are kept | S2 AQ6 | Q23 |

### 9.2 Only Madhav asks (add to the combined list)

- The clinical route for each device (Q13).
- What happens when the Board says no (Q18).
- Who signs the justification when no pre-clinical study is needed (Q20). Sharath's plan assumes the Lead.
- Whether QA already runs a quality system, holds ISO 13485 certification, and which EU notified body is planned (Q21).
- Whether trial sets and master sets are costed like prototypes (Q27).
- Whether CDSCO forms need a DSC (Q28).
- Who owns each data label and can grant exceptions (Q29).
- The target markets in order, and which devices come next (M §13.3).
- Jayon's regulatory status: licences held, certificates, notified body, US agent (M §13.3).
- An Indian legal opinion on electronic signatures, and the company secretary's view on Board resolutions (M Phase 0).

### 9.3 Only Sharath asks (add to the combined list)

- Is COAL only for Jayon, or a product for other companies too? (S1 Q1)
- Who in Jayon's IT runs COAL day to day? (S1 Q2)
- Which projects are already under way, at which steps, and do they move into COAL? (S1 Q25)
- Please confirm what the AI may do on its own, and what needs confirmation. (S2 AQ3)
- What is the company policy on AI-drafted regulated documents, and does "AI-assisted" print on the PDF? (S2 AQ4)
- What time should the daily briefing go out, how many reminders are acceptable, and may the AI raise overdue items to managers? (S2 AQ8)
- Must someone accept a task assigned to them? (S2 AQ9)
- Can we use past documents to test the AI, and who are the experts who will score its drafts? (S2 AQ10)
- What is the AI budget, and what response time is acceptable? (S2 AQ12)
- Should a mailbox be watched for lab and vendor emails, or are they uploaded by hand? (S2 AQ13)

### 9.4 Already answered by Madhav's plan (confirm, then close)

| Sharath's question | Madhav's answer |
|---|---|
| What does "BP" mean? (S1 Q20) | Boilerplate (M Part 2) |
| Will COAL be the official record? (S1 Q6) | Yes, after validation. Paper stays official until then (M §7.6) |
| Document numbering and retention (S1 Q21) | A numbering pattern per document type; regulated records kept at least 15 years (M §5.3, §7.7) |
| Shop-floor accounts and tablets (S1 Q3, Q29) | A badge and PIN on company-managed kiosk tablets (M §5.6, §8.5) |
| Covering signatures during leave (S1 Q12) | Allowed with limits; Board signatures can't be covered (M §6.1) |
| What "AI in CAD" should do (S2 AQ7) | The three connector versions (M §5.5) |
| Can purchased standards be given to the AI? (S2 AQ11) | No: only their numbers, editions and the requirements taken from them (M §5.3) |
| Web search (S2 AQ5) | A separate research assistant with no internal data (M §5.4) |
| Who can read other people's AI chats? (S2 AQ14) | Only the owner. Auditors see log details only with a grant (M §6.2, §6.4) |
| Where to host (part of S1 Q2) | AWS Mumbai, with recovery in Hyderabad (M §10.1) |

---

## 10. Gaps in both plans, and housekeeping

**Gaps in both plans**

- **Projects already under way.** Neither plan says how to bring in projects that are partway along the route. Sharath's plan only asks (S1 Q25).
- **A product, or a custom build for Jayon?** This decides:
  - who owns the code and the cloud accounts;
  - whether the design must serve other companies;
  - how COAL is priced.

  Madhav's risk register says the repository and cloud accounts "belong to the company", without saying which company. It's worth settling between the two of you first.
- **Support after go-live.** Neither plan says who fixes problems, how fast, or who is on call. Madhav's monitoring alerts the tech lead, and nothing goes beyond that.
- **Getting the data out.** If Jayon ever leaves COAL, how do they export their records and design files? Both plans index the design file; neither plans a full export.
- **Adoption.** Apart from the AI measures, neither plan measures whether people actually use COAL.
- **Malayalam on screen.** Both handle Malayalam in meetings, and Madhav also uses it for shop-floor downtime reasons. Neither decides whether the main screens need it.
- **Accessibility** isn't covered in either plan.
- **AI usage cost.** Neither plan estimates it, although both budget and report it.

**Housekeeping**

- **Madhav's research reports aren't in the repo.** PLAN.md Appendix A links to `docs/research/`, which doesn't exist. Push them, so the sources behind the legal, provider and cost claims can be checked.
- **Re-check fast-moving facts** before quoting them to Jayon: provider features and regions, prices, exchange rates and regulatory dates. Madhav's plan says the same.
- **PLAN.md was written before the folder decision.** It describes one Next.js app, but the repo now has `web/`, `app/`, `backend/` and `shared/` (6.1).
- **Sharath's plans have no costs or dates**, by design. The combined plan should take Madhav's.
- **There are two schemas.** The combined plan should use one set of table names. Madhav's is more complete; add Sharath's proposals, Dashboard layouts and event outbox to it.
- **The workflow page lives on claude.ai** (linked from PLAN.md). Keep a copy in the repo so it can't disappear.

---

## 11. Next steps

1. Read sections 1, 6 and 7 together, and mark each item: adopt, change or reject.
2. Settle the ten decisions in section 1. Start with 6.1 to 6.3 (architecture, phones, AI provider), because the rest depends on them.
3. Agree whether COAL is a product or a custom build (section 10).
4. Push Madhav's research reports to the repo.
5. Send Jayon the merged questions (section 9) and Madhav's data-collection spreadsheet (M Appendix C).
6. Write the combined plan using the outline below. Mark each addition to Jayon's workflow (section 8) as a proposal for Jayon.

**A possible outline for the combined plan**

| Part | Mostly from | Add from the other plan |
|---|---|---|
| 1. The plan on one page | M Part 1 | The decisions taken in section 6 |
| 2. Words we use | M Part 2 | Assign and cover (6.11) |
| 3. What each person sees: Dashboard, Workstation, signing | M Part 3 | Widget framework and catalogue (S1 §7); Workstation interactions (S2 §5) |
| 4. How work moves | M Part 4 | Preview and proposals (S1 §10.3); assign and request (S1 §6.4); role queues and forecast (S1 §4.8, §4.9) |
| 5. How the AI helps | M Part 5 | Action tiers (S2 §7.3); everyday skills (S2 §10.3); measures of AI value (S2 §17) |
| 6. Security clearance | M Part 6 | Write-down check (S2 §7.2); the reasoning in S2 §2 |
| 7. Signatures and compliance | M Part 7 | Step Completion Record (S1 §4.5) |
| 8. Technology | M Part 8 | Four-folder layout and API contract (S1 §10, §12.3) |
| 9. Database | M Part 9 | Proposals, Dashboard layouts, event outbox (S1 §9.4) |
| 10. Hosting and cost | M Part 10 | — |
| 11. Build plan | M Part 11 | The AI timing decided in 6.4 |
| 12. Risks | M Part 12 | AI threats (S2 §7.6) |
| 13. Decisions and questions | M Part 13 | The merged list in section 9 |
| Appendices | M Appendices A to D | API catalogue, events, widget catalogue, process definition example (S1 §4.10, §7.3, §10) |
