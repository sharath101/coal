/** Who manages the template library: the VP and the R&D Head. A convenience only: the API enforces it. */
const TEMPLATE_MANAGERS = ['vp', 'rd_head'];

export const canManageTemplates = (roleKey: string) => TEMPLATE_MANAGERS.includes(roleKey);

/** Who keeps the source library: the VP, the R&D Head and the R&D Leads (A11). The API enforces it. */
const SOURCE_KEEPERS = ['vp', 'rd_head', 'rd_lead'];

export const canManageSources = (roleKey: string) => SOURCE_KEEPERS.includes(roleKey);

/** Who researches: the people of steps C, 1 and 2 (A11). The API enforces it. */
const RESEARCHERS = ['vp', 'rd_head', 'rd_lead', 'rd_ops'];

export const canResearch = (roleKey: string) => RESEARCHERS.includes(roleKey);
