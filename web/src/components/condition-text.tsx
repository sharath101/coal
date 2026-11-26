'use client';

import type { Condition, RouteView } from '@coal/shared';
import { useTranslations } from 'next-intl';

/** Plain words for a condition the route waits for, using the names the route view carries. */
export function useConditionText(route: Pick<RouteView, 'prerequisites' | 'steps'>) {
  const t = useTranslations('conditions');
  return (c: Condition): string => {
    if ('step_approved' in c) return t('step_approved', { step: c.step_approved });
    if ('step_done' in c) return t('step_done', { step: c.step_done });
    // The route file calls a prerequisite a milestone.
    if ('milestone_reached' in c) {
      const name = route.prerequisites.find((m) => m.key === c.milestone_reached)?.name;
      return t('milestone_reached', { name: name ?? c.milestone_reached });
    }
    if ('decision_equals' in c) {
      const { step, decision, value } = c.decision_equals;
      const def = route.steps
        .find((s) => s.key === step)
        ?.decisions.find((d) => d.key === decision);
      const option = def?.options.find((o) => o.value === value)?.name;
      return t('decision_equals', { name: def?.name ?? decision, value: option ?? value });
    }
    if ('decision_recorded' in c) {
      const { step, decision } = c.decision_recorded;
      const def = route.steps
        .find((s) => s.key === step)
        ?.decisions.find((d) => d.key === decision);
      return t('decision_recorded', { name: def?.name ?? decision });
    }
    return t('no_open_corrective_actions');
  };
}
