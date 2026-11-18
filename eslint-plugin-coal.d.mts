import type { Rule } from 'eslint';

declare const plugin: {
  meta: { name: string };
  rules: Record<'part-boundaries' | 'module-tables', Rule.RuleModule>;
};
export default plugin;
