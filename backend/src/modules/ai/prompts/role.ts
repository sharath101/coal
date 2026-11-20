import type { RouteDefinition } from '@coal/shared';

/** Layer 3: what this person's role does and signs, worked out from the route. */
export function roleSummary(roleKey: string, roleName: string, routes: RouteDefinition[]): string {
  const lines = routes.flatMap((route) => {
    const does = route.steps.filter((s) => s.doers.includes(roleKey));
    const signs = route.steps.filter((s) => s.signer === roleKey);
    const list = (steps: typeof does) => steps.map((s) => `${s.key} ${s.name}`).join('; ');
    return [
      `In the ${route.name}, ${roleName} does: ${does.length > 0 ? list(does) : 'no steps'}.`,
      `${roleName} signs off: ${signs.length > 0 ? list(signs) : 'no steps'}.`,
    ];
  });
  return `THE PERSON'S ROLE\n${lines.join('\n')}`;
}
