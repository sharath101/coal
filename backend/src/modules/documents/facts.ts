import type { StepDefinition } from '@coal/shared';

/** What the documents module needs to know about a project, handed to it by the department module. */
export interface ProjectFacts {
  orgId: string;
  projectId: string;
  code: string;
  name: string;
  description: string;
  productLineId: string | null;
  productLineName: string;
  runId: string;
  /** For example "Stage 2 · Plan, design and source". */
  stage: string;
  /** The active team. */
  team: { id: string; name: string; roleKey: string }[];
}

/** A step of the project in its current iteration. */
export interface StepFacts {
  def: StepDefinition;
  runStepId: string;
  iteration: number;
  status: string;
}

export const memberIdsOf = (facts: ProjectFacts) => facts.team.map((m) => m.id);
