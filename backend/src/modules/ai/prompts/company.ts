import type { RouteDefinition } from '@coal/shared';

/**
 * Layer 2: what the company and its process are. The route's steps come from the route
 * definition itself, so the AI never works from an out-of-date copy.
 */
export const COMPANY_FACTS = `ABOUT JAYON AND COAL
- Jayon makes orthopaedic implants and instruments. COAL is its platform; it starts with R&D, taking a product from idea to launch.
- Product lines: Arthroscopy (ART), Spine (SPN) and Trauma (TRM). A project code looks like SPN-26-004: line, year, number.
- Reporting line in R&D: Board > VP > R&D Head > R&D Lead (one per product line) > design engineers, AEMS, PME, R&D Ops, DARD and QC inspectors. Company QA, Quality Control, Production and Marketing are outside R&D.
- Every project follows one route of steps. A step has doers, and most have a signer who signs it off. Checkpoints (4, 12, 18, 23) are go or no-go points. Work can be sent back to an earlier step.
- A step is late when it passes its planned end. Late work needs a recorded reason (a deviation) with a new date, which the next role up confirms.
- A step's tasks follow the step: they are started, handed in and closed through the step (starting it, then submitting it for sign-off), and close when the step is signed off. A task cannot be marked done by itself, so never offer that: for a task with followsStep, say the step is submitted (and offer a card for it if the person asks).
- Documents are made from templates, saved as numbered draft versions, then signed in rows: Prepared, Reviewed, Approved.

DATES (they answer different questions, so two of them differing is not a conflict)
- Planned end: the date in the plan. It changes only by a recorded change.
- A deviation's new date: the date the doer promised to finish their work. It becomes that work task's due date.
- A step's forecast end: when the step is expected to be finished, signature included. It is the latest of today, the doer's new date and, once the work is handed in, the few working days a signer is given. So it can be later than a deviation's new date by the signing wait.
- The forecast launch is the forecast end of the last step. Always say which date you mean.

WORDS AND ABBREVIATIONS
AEMS: Advanced Engineering and Materials Science (FEA and metallurgy experts). CDSCO: India's device regulator. CE: the EU's mark. DARD: Design Assurance and Regulatory Documentation. FEA: finite element analysis, a computer stress analysis. IFU: instructions for use. KOL: key opinion leader, a leading surgeon. MD: Managing Director (signs Board approvals with the CEO). MIS: Material Issue Slip. NCI: non-conformity investigation. PID: Project Initiation Document (step 1, names the team). PME: Prototype Manufacturing and Engineering. QA/QC: quality assurance / quality control. TRF: test request form. UDI: unique device identification. Go: the VP's signed decision that creates a project.`;

/** The steps of each route: key, name, stage, who does and signs it. */
export function routeSummary(routes: RouteDefinition[]): string {
  return routes
    .map((route) => {
      const stages = route.stages.map((s) => `${s.no}. ${s.name}`).join('; ');
      const steps = route.steps
        .map(
          (s) =>
            `${s.key} ${s.name} (stage ${s.stage}; does: ${s.doers.join(', ')}; signs: ${s.signer ?? 'nobody'}${s.checkpoint ? '; checkpoint' : ''})`,
        )
        .join('\n');
      return `THE ${route.name.toUpperCase()}\nStages: ${stages}\nSteps:\n${steps}`;
    })
    .join('\n\n');
}
