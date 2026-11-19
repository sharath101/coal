import { DEFAULT_NUMBERING, type SignaturePlan } from '@coal/shared';

/**
 * The kinds of document COAL starts with (docs/documents-and-signing.md#kinds-of-documents).
 * They are data: loaded into `document_types` on deploy. A template adds a type's layout and
 * fields; the type says where it belongs, how it is numbered and who signs.
 */
export interface DocumentTypeSeed {
  code: string;
  name: string;
  department: string | null;
  kind: 'template' | 'upload' | 'record';
  sensitivity?: 'normal' | 'budget';
  /** The steps it may be made on. Empty: any step. */
  steps: string[];
  numbering: string;
  plan: SignaturePlan;
}

const prepared: SignaturePlan = { rows: ['prepared', 'approved'], reviewedBy: [], approvedBy: [] };
// ⚠ Who reviews each document type is still open (S1): the table in documents-and-signing.md.
const reviewedBy = (...roles: string[]): SignaturePlan => ({
  rows: ['prepared', 'reviewed', 'approved'],
  reviewedBy: roles,
  approvedBy: [],
});

export const DOCUMENT_TYPES: DocumentTypeSeed[] = [
  {
    code: 'PID',
    name: 'Project Initiation Document',
    department: 'RND',
    kind: 'template',
    steps: ['1'],
    numbering: DEFAULT_NUMBERING,
    plan: reviewedBy('dard'),
  },
  {
    code: 'MRS',
    name: 'Market Research Survey',
    department: 'RND',
    kind: 'template',
    steps: ['2'],
    numbering: DEFAULT_NUMBERING,
    plan: reviewedBy('rd_lead'),
  },
  {
    code: 'REG_PLAN',
    name: 'Regulatory plan',
    department: 'RND',
    kind: 'template',
    steps: ['2a'],
    numbering: '{project_code}-REG-{nn}',
    // Step 2a has no sign-off yet, so only the author signs.
    plan: { rows: ['prepared'], reviewedBy: [], approvedBy: [] },
  },
  {
    code: 'PROJECT_PLANNING',
    name: 'Project Planning',
    department: 'RND',
    kind: 'template',
    steps: ['3'],
    numbering: '{project_code}-PLN-{nn}',
    plan: prepared,
  },
  {
    code: 'APPROVAL_FORM',
    name: 'Project Approval Form',
    department: 'RND',
    kind: 'template',
    steps: ['3'],
    numbering: '{project_code}-PAF-{nn}',
    plan: prepared,
  },
  {
    code: 'ACTION_PLAN',
    name: 'Action Plan',
    department: 'RND',
    kind: 'template',
    steps: ['5'],
    numbering: '{project_code}-ACT-{nn}',
    plan: reviewedBy('dard'),
  },
  {
    code: 'BUDGET_ANNEX',
    name: 'Budget annex',
    department: 'RND',
    kind: 'template',
    // A separate document, so the plan can be shared without the budget (docs/roles-and-access.md).
    sensitivity: 'budget',
    steps: ['5'],
    numbering: '{project_code}-BUD-{nn}',
    plan: prepared,
  },
  {
    code: 'DOC',
    name: 'Other document',
    department: null,
    kind: 'upload',
    steps: [],
    numbering: '{project_code}-DOC-{nn}',
    plan: prepared,
  },
  {
    code: 'STEP_SIGNOFF',
    name: 'Step sign-off record',
    department: null,
    kind: 'record',
    steps: [],
    numbering: '{project_code}-SO-{nn}',
    plan: prepared,
  },
];
