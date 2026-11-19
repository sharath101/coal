/** Who manages the template library: the VP and the R&D Head. A convenience only: the API enforces it. */
const TEMPLATE_MANAGERS = ['vp', 'rd_head'];

export const canManageTemplates = (roleKey: string) => TEMPLATE_MANAGERS.includes(roleKey);
