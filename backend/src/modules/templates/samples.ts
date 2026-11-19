import { TemplateSpec } from '@coal/shared';
import { blocksFromSpec, buildDocx } from './docx-builder';

/**
 * Made-up sample templates, so the library works before Jayon's own forms arrive. They are
 * ordinary templates: the same specification and the same Word placeholders. Their layout is
 * plain on purpose; Jayon's real forms replace them (docs/documents-and-signing.md#where-templates-live).
 */
export interface SampleTemplate {
  spec: TemplateSpec;
  intro: string;
}

const header = (extra: Record<string, unknown> = {}) => ({
  id: 'header',
  title: 'Project',
  kind: 'fields',
  fields: {
    project_code: { from: 'project.code', label: 'Project code' },
    project_name: { from: 'project.name', label: 'Project name' },
    product_line: { from: 'project.product_line', label: 'Product line' },
    document_number: { from: 'document.number', label: 'Document number' },
    date: { from: 'today', label: 'Date' },
    prepared_by: { from: 'author.name', label: 'Prepared by' },
    ...extra,
  },
});

const team = {
  id: 'team',
  title: 'Project team',
  kind: 'fields',
  fields: { members: { from: 'project.team', label: 'Members' } },
};

const SAMPLES: { spec: unknown; intro: string }[] = [
  {
    intro: 'Sample form with made-up wording. Jayon’s own Project Initiation Document replaces it.',
    spec: {
      template: 'Project Initiation Document (sample)',
      document_type: 'PID',
      steps: ['1'],
      sections: [
        header(),
        {
          id: 'purpose',
          title: 'Purpose and clinical need',
          kind: 'written',
          instructions: 'State the clinical and market need in 120 to 200 words.',
          sources: ['concept'],
          required: true,
        },
        {
          id: 'markets',
          title: 'Target markets',
          kind: 'fields',
          fields: {
            target_markets: { from: 'person', label: 'Target markets', required: true },
            launch_year: { from: 'person', label: 'Planned launch year' },
          },
        },
        team,
        {
          id: 'risks',
          title: 'Known risks',
          kind: 'written',
          instructions: 'List the main technical, regulatory and supply risks.',
          sources: ['purpose'],
        },
      ],
      signature_rows: ['prepared', 'reviewed', 'approved'],
      reviewed_by: ['dard'],
    },
  },
  {
    intro: 'Sample form with made-up wording.',
    spec: {
      template: 'Market Research Survey (sample)',
      document_type: 'MRS',
      steps: ['2'],
      sections: [
        header(),
        {
          id: 'scope',
          title: 'Scope',
          kind: 'fields',
          fields: {
            regions: { from: 'person', label: 'Regions covered', required: true },
            competitors: { from: 'person', label: 'Competitors studied', multiline: true },
          },
        },
        {
          id: 'market_size',
          title: 'Market size and growth',
          kind: 'written',
          instructions:
            'Give the size of the market and its yearly growth, with the source of each figure.',
          sources: ['step:2.documents'],
          required: true,
        },
        {
          id: 'findings',
          title: 'Findings',
          kind: 'written',
          instructions: 'Summarise what surgeons and distributors said.',
          sources: ['market_size'],
        },
      ],
      signature_rows: ['prepared', 'reviewed', 'approved'],
      reviewed_by: ['rd_lead'],
    },
  },
  {
    intro: 'Sample form with made-up wording.',
    spec: {
      template: 'Regulatory plan (sample)',
      document_type: 'REG_PLAN',
      steps: ['2a'],
      sections: [
        header(),
        {
          id: 'bodies',
          title: 'Approving bodies',
          kind: 'written',
          instructions: 'List each body that must approve the product, and why.',
          required: true,
        },
        {
          id: 'documents_needed',
          title: 'Documents each body needs',
          kind: 'written',
          instructions: 'For each body, list the documents it will ask for.',
        },
      ],
      signature_rows: ['prepared'],
    },
  },
  {
    intro: 'Sample form with made-up wording.',
    spec: {
      template: 'Project Planning (sample)',
      document_type: 'PROJECT_PLANNING',
      steps: ['3'],
      sections: [
        header(),
        {
          id: 'scope_of_work',
          title: 'Scope of work',
          kind: 'written',
          instructions: 'Describe what the project will deliver, stage by stage.',
          required: true,
        },
        {
          id: 'resources',
          title: 'Resources',
          kind: 'fields',
          fields: {
            people_needed: { from: 'person', label: 'People needed', multiline: true },
            equipment: { from: 'person', label: 'Equipment', multiline: true },
          },
        },
        team,
      ],
      signature_rows: ['prepared', 'approved'],
    },
  },
  {
    intro: 'Sample form with made-up wording.',
    spec: {
      template: 'Project Approval Form (sample)',
      document_type: 'APPROVAL_FORM',
      steps: ['3'],
      sections: [
        header(),
        {
          id: 'proposal',
          title: 'Proposal',
          kind: 'written',
          instructions: 'Summarise what is proposed and why it should go to the Board.',
          required: true,
        },
        {
          id: 'request',
          title: 'Approval requested',
          kind: 'fields',
          fields: {
            approval_for: { from: 'person', label: 'Approval requested for', required: true },
            board_date: { from: 'person', label: 'Board meeting date' },
          },
        },
      ],
      signature_rows: ['prepared', 'approved'],
    },
  },
  {
    intro: 'Sample form with made-up wording.',
    spec: {
      template: 'Action Plan (sample)',
      document_type: 'ACTION_PLAN',
      steps: ['5'],
      sections: [
        header(),
        team,
        {
          id: 'schedule',
          title: 'Dates for each role',
          kind: 'fields',
          fields: {
            design_dates: { from: 'person', label: 'Design', multiline: true },
            prototype_dates: { from: 'person', label: 'Prototype', multiline: true },
            testing_dates: { from: 'person', label: 'Testing', multiline: true },
          },
        },
        {
          id: 'raw_material',
          title: 'Raw material definition',
          kind: 'fields',
          fields: {
            material: { from: 'person', label: 'Material', required: true },
            grade: { from: 'person', label: 'Grade or standard' },
          },
        },
        {
          id: 'plan_notes',
          title: 'Notes',
          kind: 'written',
          instructions:
            'Anything the reviewers should know about the plan. Costs go in the budget annex.',
        },
      ],
      signature_rows: ['prepared', 'reviewed', 'approved'],
      reviewed_by: ['dard'],
    },
  },
  {
    intro:
      'Sample form with made-up wording. Kept apart from the Action Plan so the plan can be shared without the figures.',
    spec: {
      template: 'Budget annex (sample)',
      document_type: 'BUDGET_ANNEX',
      steps: ['5'],
      sections: [
        header(),
        {
          id: 'costs',
          title: 'Costs',
          kind: 'fields',
          fields: {
            material_cost: { from: 'person', label: 'Material', required: true },
            tooling_cost: { from: 'person', label: 'Tooling' },
            testing_cost: { from: 'person', label: 'Testing' },
            total_budget: { from: 'person', label: 'Total', required: true },
          },
        },
        {
          id: 'justification',
          title: 'Justification',
          kind: 'written',
          instructions: 'Explain the main costs.',
        },
      ],
      signature_rows: ['prepared', 'approved'],
    },
  },
];

export const SAMPLE_TEMPLATES: SampleTemplate[] = SAMPLES.map((s) => ({
  spec: TemplateSpec.parse(s.spec),
  intro: s.intro,
}));

/** A Word file that follows a sample's specification exactly. */
export const sampleDocx = (sample: SampleTemplate): Buffer =>
  buildDocx(blocksFromSpec(sample.spec, sample.intro), 'COAL sample template · made-up wording');
