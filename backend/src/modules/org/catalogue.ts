/**
 * The departments, roles and positions COAL starts with (docs/roles-and-access.md#roles).
 * They are data: this list is loaded into the `departments`, `roles` and `positions` tables on
 * deploy, and new departments add rows here, not code paths.
 */
export interface DepartmentSeed {
  code: string;
  name: string;
}

/** What a person may do on the route. Positions on the org chart each hold one. */
export interface RoleSeed {
  key: string;
  name: string;
  department: string | null;
}

/**
 * A box on Jayon's org chart: a title, the role it holds, who it reports to and how many people
 * may hold it (P111). Anyone choosing a position takes one of its seats.
 */
export interface PositionSeed {
  key: string;
  title: string;
  role: string;
  /** The position this one reports to. Empty: the top of its line. */
  reportsTo: string | null;
  /** One seat count for each product line (a Lead, the design engineers), instead of one for all. */
  perProductLine?: boolean;
  /** Empty: no limit. */
  seats: number | null;
  /** False for positions that can't be chosen at sign-up or in a profile (the demo admin). */
  selfService?: boolean;
}

export const DEPARTMENTS: DepartmentSeed[] = [
  { code: 'RND', name: 'R&D' },
  { code: 'QA', name: 'Quality Assurance' },
  { code: 'QC', name: 'Quality Control' },
  { code: 'PROD', name: 'Production' },
  { code: 'MKT', name: 'Marketing' },
];

export const ROLES: RoleSeed[] = [
  { key: 'board', name: 'Board', department: null },
  { key: 'vp', name: 'VP', department: null },
  { key: 'rd_head', name: 'R&D Head', department: 'RND' },
  { key: 'rd_lead', name: 'R&D Lead', department: 'RND' },
  { key: 'design_engineer', name: 'Design engineer', department: 'RND' },
  { key: 'aems', name: 'AEMS', department: 'RND' },
  { key: 'pme', name: 'PME', department: 'RND' },
  { key: 'rd_ops', name: 'R&D Ops', department: 'RND' },
  { key: 'dard', name: 'DARD', department: 'RND' },
  { key: 'qc_inspector', name: 'QC inspector', department: 'RND' },
  // Makes the graphics for R&D. No step of the route names it: it gets the work it is given.
  { key: 'graphics_designer', name: 'Graphics designer', department: 'RND' },
  { key: 'company_qa', name: 'Company QA', department: 'QA' },
  { key: 'quality_control', name: 'Quality Control', department: 'QC' },
  { key: 'production', name: 'Production', department: 'PROD' },
  { key: 'marketing', name: 'Marketing', department: 'MKT' },
  // The demo admin: only switches between people, and has no part in the route (P113).
  { key: 'admin', name: 'Admin', department: null },
];

export const POSITIONS: PositionSeed[] = [
  {
    key: 'managing_director',
    title: 'Managing Director',
    role: 'board',
    reportsTo: null,
    seats: 1,
  },
  // ⚠ Not on the chart, but the workflow has the MD and the CEO sign as the Board (W2).
  { key: 'ceo', title: 'CEO', role: 'board', reportsTo: null, seats: 1 },
  {
    key: 'vp',
    title: 'VP, Product Strategy & Global BD',
    role: 'vp',
    reportsTo: 'managing_director',
    seats: 1,
  },
  { key: 'rd_head', title: 'R&D Head', role: 'rd_head', reportsTo: 'vp', seats: 1 },
  {
    key: 'rd_lead',
    title: 'R&D Lead',
    role: 'rd_lead',
    reportsTo: 'rd_head',
    perProductLine: true,
    seats: 1,
  },
  {
    key: 'design_engineer',
    title: 'Design engineer',
    role: 'design_engineer',
    reportsTo: 'rd_lead',
    perProductLine: true,
    seats: 5,
  },
  {
    key: 'metallurgy_expert',
    title: 'Metallurgy expert',
    role: 'aems',
    reportsTo: 'rd_head',
    seats: 1,
  },
  { key: 'fea_expert', title: 'FEA expert', role: 'aems', reportsTo: 'rd_head', seats: 1 },
  {
    key: 'ops_manager',
    title: 'Asst. Manager, R&D Ops',
    role: 'rd_ops',
    reportsTo: 'rd_head',
    seats: 1,
  },
  // ⚠ The chart gives no number for the operations analyst (A12).
  {
    key: 'ops_analyst',
    title: 'Operations analyst',
    role: 'rd_ops',
    reportsTo: 'ops_manager',
    seats: 1,
  },
  {
    key: 'graphics_designer',
    title: 'Graphics designer',
    role: 'graphics_designer',
    reportsTo: 'ops_manager',
    seats: 2,
  },
  { key: 'dard_lead', title: 'DARD Lead', role: 'dard', reportsTo: 'rd_head', seats: 1 },
  {
    key: 'dard_engineer',
    title: 'DARD engineer',
    role: 'dard',
    reportsTo: 'dard_lead',
    seats: 2,
  },
  {
    key: 'qc_inspector',
    title: 'QC inspector',
    role: 'qc_inspector',
    reportsTo: 'dard_lead',
    seats: 3,
  },
  {
    key: 'pme_manager',
    title: 'Asst. Manager, PME',
    role: 'pme',
    reportsTo: 'rd_head',
    seats: 1,
  },
  { key: 'pme_staff', title: 'PME staff', role: 'pme', reportsTo: 'pme_manager', seats: null },
  // ⚠ Roles outside R&D aren't on the chart (A4).
  { key: 'company_qa', title: 'Company QA', role: 'company_qa', reportsTo: null, seats: null },
  {
    key: 'quality_control',
    title: 'Quality Control',
    role: 'quality_control',
    reportsTo: null,
    seats: null,
  },
  { key: 'production', title: 'Production', role: 'production', reportsTo: null, seats: null },
  { key: 'marketing', title: 'Marketing', role: 'marketing', reportsTo: null, seats: null },
  { key: 'admin', title: 'Admin', role: 'admin', reportsTo: null, seats: 1, selfService: false },
];

const POSITION_BY_KEY = new Map(POSITIONS.map((p) => [p.key, p]));

export const positionSeed = (key: string): PositionSeed | undefined => POSITION_BY_KEY.get(key);

/** The first position of a role: where an account that only knows its role is placed. */
export const firstPositionOfRole = (roleKey: string): PositionSeed | undefined =>
  POSITIONS.find((p) => p.role === roleKey);
