'use client';

import type { WidgetKey } from '@coal/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import {
  panelHref,
  QUESTION_TITLE,
  QUESTIONS,
  readPanel,
  type PanelState,
} from '@/components/widgets/panel-state';
import { WidgetCard } from '@/components/widgets/widget-card';
import { WidgetPanel } from '@/components/widgets/widget-panel';
import { useWidgetLayout } from '@/lib/queries';

/**
 * The widget grid, in the order of my layout and grouped under the three questions. The open
 * panel is part of the URL (`?w=my-tasks&tab=done&project=…`), so it can be linked to, Back closes
 * it, and so does Esc.
 */
export function DashboardWidgets() {
  const t = useTranslations('dashboard');
  const router = useRouter();
  const params = useSearchParams();
  const layout = useWidgetLayout();
  // Whether the panel was opened from this page, so closing can go Back instead of adding history.
  const openedHere = useRef(false);

  if (layout.error) return <ProblemMessage error={layout.error} />;
  if (!layout.data) return null;
  const { widgets } = layout.data;
  const order = layout.data.layout;
  if (order.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        {t('empty')}
      </p>
    );
  }
  const infoOf = (key: WidgetKey) => widgets.find((w) => w.key === key);
  const panel = readPanel(params, order);
  const panelInfo = panel ? infoOf(panel.key) : undefined;

  const open = (key: WidgetKey) => {
    openedHere.current = true;
    router.push(panelHref({ key, tab: null, filters: {} }), { scroll: false });
  };
  const change = (next: PanelState) => router.replace(panelHref(next), { scroll: false });
  const close = () => {
    if (openedHere.current) {
      openedHere.current = false;
      router.back();
    } else {
      router.replace('/dashboard', { scroll: false });
    }
  };

  return (
    <>
      {QUESTIONS.map((question) => {
        const infos = order.flatMap((key) => {
          const info = infoOf(key);
          return info && info.question === question ? [info] : [];
        });
        if (infos.length === 0) return null;
        return (
          <section key={question} className="grid gap-3" aria-labelledby={`question-${question}`}>
            <h2
              id={`question-${question}`}
              className="text-sm font-medium tracking-wide text-muted-foreground uppercase"
            >
              {t(QUESTION_TITLE[question])}
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {infos.map((info) => (
                <WidgetCard key={info.key} info={info} onOpen={() => open(info.key)} />
              ))}
            </div>
          </section>
        );
      })}
      {panel && panelInfo && (
        <WidgetPanel info={panelInfo} state={panel} onChange={change} onClose={close} />
      )}
    </>
  );
}
