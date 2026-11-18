# Regulatory notes (reference only)

**Read this when** you design a step module, signatures, records or data handling, and need to know what the rules may require.
**Status:** **reference only. Nothing here is designed or built yet.**

These notes come from Madhav's research, checked on 16 November 2026 ([archive/PLAN.md](./archive/PLAN.md)). The research reports themselves aren't in the repo yet. Before anything here becomes part of COAL:

- we need the full picture from Jayon, their QA team and, for the signature points, an Indian lawyer;
- the facts must be re-checked, because rules, provider features and prices change;
- each item gets a decision in [decisions.md](./decisions.md) and a design in the right doc.

---

## What the research found

### Medical device rules in India (CDSCO)

| Topic | What the research found | What it may mean for COAL | Where it's discussed in the archive |
|---|---|---|---|
| **Test licence** (before steps 10 and 11) | Devices made for testing, evaluation or clinical investigation need a test licence: applied for on Form MD-12 and granted on Form MD-13 (Rule 31). CDSCO decides in about 30 days, and the licence lasts three years. A ledger of units made, tested, stocked and disposed of is required. Some Class A, non-sterile, non-measuring instruments may be exempt | A gate on steps 10 and 11 that checks the licence's validity, place and remaining quantity, plus the ledger. For now: the "test licence recorded" milestone, entered by hand ([workflow.md](./workflow.md#starting-steps)) | [PLAN.md, stage 3](./archive/PLAN.md#stage-3-make-the-prototype) |
| **Clinical trials** (steps 19 and 20) | Using an unlicensed implant in patients can be a clinical investigation. That needs CDSCO permission (Forms MD-22 and MD-23), approval from an ethics committee registered with CDSCO, registration on CTRI, patient consent and insurance. Serious adverse events must be reported within 48 hours, with a detailed report within 14 days. Which route applies depends on whether an equivalent device is already approved in India | A clinical route decision at step 19, and step 20 opening at a hospital only once that hospital's approvals are recorded. Patients identified only by codes, and adverse-event deadlines tracked | [PLAN.md, stage 5](./archive/PLAN.md#stage-5-clinical-trials) |
| **"PMCF"** | The EU's post-market clinical follow-up applies only after CE marking. Before that, the step-20 follow-up is part of the clinical investigation | Use the right term in documents and screens | [PLAN.md, Appendix B](./archive/PLAN.md#appendix-b--abbreviations) |
| **Quality records** (Medical Devices Rules, Fifth Schedule) | Quality-system documents must be "approved, signed and dated". Electronic records must be printable, critical data typed by hand must be checked by a second person, changes must be recorded, and versions need effective dates | Printing with signatures and history; a "Verified" second-person signature for typed critical values; effective dates on versions | [PLAN.md §7.1](./archive/PLAN.md#71-what-the-rules-require) |

### Signatures

| Topic | What the research found | What it may mean for COAL | Where it's discussed in the archive |
|---|---|---|---|
| **India's IT Act** | Where a law requires a signature, only a Digital Signature Certificate (DSC) or an Aadhaar eSign counts electronically | Get an Indian legal opinion. A possible eSign step for the document types the lawyer names, starting with the Board approvals (about ₹15 to 25 per eSign) | [PLAN.md §7.4](./archive/PLAN.md#74-when-a-stronger-signature-is-needed) |
| **FDA's 21 CFR Part 11** (if a product is meant for the US) | Electronic signatures must be unique to one person, show the printed name, date, time and meaning, be linked to the record, and need re-authentication. Audit trails must be secure. The company files a one-time letter with FDA | Our passkey design already aims at this ([documents-and-signing.md](./documents-and-signing.md#signing-with-face-id-or-fingerprint)). Document passkeys as a two-part signature, not a "biometric" one. The FDA letter before the first signature on a US project | [PLAN.md §7.2, §7.3](./archive/PLAN.md#72-what-we-build-on-day-one) |
| **Sealed PDFs** | A company certificate and a trusted timestamp from an authority licensed in India (PAdES) let anyone check that a final PDF hasn't changed | Seal final PDFs once real records exist | [PLAN.md §7.2](./archive/PLAN.md#72-what-we-build-on-day-one) |

### Design controls, risk and the EU and US markets

| Topic | What the research found | What it may mean for COAL | Where it's discussed in the archive |
|---|---|---|---|
| **Design controls** (ISO 13485 §7.3, FDA's QMSR) | Auditors expect design inputs, design reviews (including a design freeze), verification, validation, transfer, design change records, and a design and development file | Possible additions to the route: design inputs with the Action Plan, a design freeze review after steps 7 and 8, a design change record at step 21, an automatic index of each product's design file. **These change Jayon's process, so Jayon must agree first** | [PLAN.md §7.7](./archive/PLAN.md#77-records-auditors-will-look-for) |
| **Risk management** (ISO 14971) | A risk management plan, a risk file linked to the FEA, tests and changes, and a risk management report approved before release | A risk plan with the Action Plan (step 5), a risk file, and the report before step 23 | [PLAN.md §7.7](./archive/PLAN.md#77-records-auditors-will-look-for) |
| **EU MDR** | Device identifiers (UDI) and EUDAMED registration; an implant card and a summary of safety and clinical performance for some implants; records kept at least 15 years after the last implant is placed on the market; a signed Declaration of Conformity (wet ink, or an EU qualified e-signature) | Extra work at steps 17 and 22; long retention | [PLAN.md, stage 4](./archive/PLAN.md#stage-4-test-and-gather-feedback) |
| **FDA 510(k)** | Usually the route for moderate-risk devices. Filed in the eSTAR form; devices registered in GUDID | Submission support at step 22 | [PLAN.md §7.4](./archive/PLAN.md#74-when-a-stronger-signature-is-needed) |
| **Purchased standards** (ISO, ASTM) | Their licences don't allow their text to be fed to an AI | Store only each standard's number, edition and the requirements people extract, never the text | [PLAN.md §5.3](./archive/PLAN.md#53-documents-from-boilerplates) |

### Validation, data and security

| Topic | What the research found | What it may mean for COAL | Where it's discussed in the archive |
|---|---|---|---|
| **Validating COAL itself** (ISO 13485 §4.1.6, FDA's Computer Software Assurance guidance) | Software used in the quality system must be validated for its intended use, with effort scaled to risk. Labelling, regulatory gates and traceability are higher risk; tasks, dashboards and AI drafts signed by people are lower | Keep the automated tests as evidence from the start. **Paper stays the official record until a validation report is signed** | [PLAN.md §7.6](./archive/PLAN.md#76-validating-coal-itself) |
| **DPDP Act 2023** (main duties from about 2027) | Reasonable safeguards for personal data; notices; breach reporting; contracts with processors. It doesn't require data to stay in India | Patients never named in COAL; contracts with AWS and the AI providers; a breach procedure | [PLAN.md §7.1](./archive/PLAN.md#71-what-the-rules-require) |
| **CERT-In Directions (2022)** | Report cyber incidents within 6 hours; keep logs for 180 days in India; sync clocks to Indian time sources; name a point of contact | Logs kept in India; an incident procedure; a clock check | [PLAN.md §8.6](./archive/PLAN.md#86-running-it-safely) |
| **AI and data in India** | Provider options for processing data in India were limited and changing at the time of the research | Decide which data may go to which AI provider before real data is used | [PLAN.md §5.8](./archive/PLAN.md#58-ai-models-and-providers) |

## Before COAL holds official records

None of these is needed while COAL holds made-up data. All of them are needed before it holds real, official records:

1. **Sign-in and signing.** Real sign-in, plus an identity check, an e-signature agreement and training for everyone who signs.
2. **Legal advice.** An Indian legal opinion on electronic signatures. Also the company secretary's view on whether the Board approvals are statutory resolutions.
3. **Validation.** A validation plan and report for COAL's intended use, and written procedures (signatures, accounts, backups, AI-assisted writing, incidents).
4. **Data and AI.** A data policy for the AI providers. Real hosting with backups and a tested restore.
5. **Jayon's agreement** to any changes to their route that come from these notes.

## How to use this doc

1. **Consult it.** When you design a step module or a records feature, check here first.
2. **Bring Jayon in.** Confirm the point with Jayon and QA. Get legal advice where it's a legal point.
3. **Record and design.** Record the decision in [decisions.md](./decisions.md), and design it in the right doc.
4. **Mark it.** Note here that it's been taken up, with a link to where it now lives.
