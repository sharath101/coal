'use client';

import type { ProductLine, RolesResponse } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { selectClass } from '@/components/ui/select-class';

interface Props {
  roles: RolesResponse;
  productLines: ProductLine[];
  positionKey: string;
  productLineId: string;
  onPositionChange: (key: string) => void;
  onProductLineChange: (id: string) => void;
  /** The person's own seat, which is theirs to keep even when the position is full. */
  own?: { positionKey: string; productLineId: string } | undefined;
}

/**
 * The position on Jayon's org chart, grouped by department, and a product line when the position
 * is counted by line. A position with no seat left can't be chosen. Everything comes from the API.
 */
export function PositionFields({
  roles,
  productLines,
  positionKey,
  productLineId,
  onPositionChange,
  onProductLineChange,
  own,
}: Props) {
  const t = useTranslations('signUp');
  const groups: { code: string | null; name: string }[] = [
    { code: null, name: t('aboveDepartments') },
    ...roles.departments,
  ];
  const chosen = roles.positions.find((p) => p.key === positionKey);
  const isOwn = (key: string, lineId = '') =>
    own?.positionKey === key && (lineId === '' || own.productLineId === lineId);

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="position">{t('position')}</Label>
        <select
          id="position"
          required
          className={selectClass}
          value={positionKey}
          onChange={(e) => onPositionChange(e.target.value)}
        >
          <option value="" disabled>
            {t('choosePosition')}
          </option>
          {groups.map((group) => {
            const options = roles.positions.filter((p) => p.departmentCode === group.code);
            if (options.length === 0) return null;
            return (
              <optgroup key={group.code ?? 'above'} label={group.name}>
                {options.map((p) => (
                  <option key={p.key} value={p.key} disabled={p.full && !isOwn(p.key)}>
                    {p.full && !isOwn(p.key) ? t('fullPosition', { title: p.title }) : p.title}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        {chosen?.seats && !chosen.perProductLine && (
          <p className="text-xs text-muted-foreground">{t('seats', { count: chosen.seats })}</p>
        )}
      </div>

      {chosen?.perProductLine && (
        <div className="grid gap-2">
          <Label htmlFor="product-line">{t('productLine')}</Label>
          <select
            id="product-line"
            required
            className={selectClass}
            value={productLineId}
            onChange={(e) => onProductLineChange(e.target.value)}
          >
            <option value="" disabled>
              {t('chooseProductLine')}
            </option>
            {productLines.map((line) => {
              const full = chosen.fullProductLineIds.includes(line.id);
              const lock = full && !isOwn(chosen.key, line.id);
              return (
                <option key={line.id} value={line.id} disabled={lock}>
                  {lock ? t('fullLine', { line: line.name }) : line.name}
                </option>
              );
            })}
          </select>
          {chosen.seats && (
            <p className="text-xs text-muted-foreground">
              {t('seatsPerLine', { count: chosen.seats })}
            </p>
          )}
        </div>
      )}
    </>
  );
}
