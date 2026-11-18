/**
 * The departments and roles COAL starts with (docs/roles-and-access.md#roles).
 * They are data: this list is loaded into the `departments` and `roles` tables on deploy,
 * and new departments add rows here, not code paths.
 */
export interface DepartmentSeed {
  code: string;
  name: string;
}

export interface RoleSeed {
  key: string;
  name: string;
  department: string | null;
  /** The reporting line until there's an org chart (P8). Empty: not on the R&D ladder. */
  reportsTo: string | null;
  needsProductLine?: boolean;
}

export const DEPARTMENTS: DepartmentSeed[] = [
  { code: 'RND', name: 'R&D' },
  { code: 'QA', name: 'Quality Assurance' },
  { code: 'QC', name: 'Quality Control' },
  { code: 'PROD', name: 'Production' },
  { code: 'MKT', name: 'Marketing' },
];

export const ROLES: RoleSeed[] = [
  { key: 'board', name: 'Board', department: null, reportsTo: null },
  { key: 'vp', name: 'VP', department: null, reportsTo: 'board' },
  { key: 'rd_head', name: 'R&D Head', department: 'RND', reportsTo: 'vp' },
  {
    key: 'rd_lead',
    name: 'R&D Lead',
    department: 'RND',
    reportsTo: 'rd_head',
    needsProductLine: true,
  },
  { key: 'design_engineer', name: 'Design engineer', department: 'RND', reportsTo: 'rd_lead' },
  { key: 'aems', name: 'AEMS', department: 'RND', reportsTo: 'rd_lead' },
  { key: 'pme', name: 'PME', department: 'RND', reportsTo: 'rd_lead' },
  { key: 'rd_ops', name: 'R&D Ops', department: 'RND', reportsTo: 'rd_lead' },
  { key: 'dard', name: 'DARD', department: 'RND', reportsTo: 'rd_lead' },
  { key: 'qc_inspector', name: 'QC inspector', department: 'RND', reportsTo: 'rd_lead' },
  // ⚠ Roles outside R&D aren't on the ladder until there's an org chart (A4).
  { key: 'company_qa', name: 'Company QA', department: 'QA', reportsTo: null },
  { key: 'quality_control', name: 'Quality Control', department: 'QC', reportsTo: null },
  { key: 'production', name: 'Production', department: 'PROD', reportsTo: null },
  { key: 'marketing', name: 'Marketing', department: 'MKT', reportsTo: null },
];
