'use client';

import type { ProductLine, RolesResponse } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export const selectClass = cn(
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none',
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
);

interface Props {
  roles: RolesResponse;
  productLines: ProductLine[];
  roleKey: string;
  productLineId: string;
  onRoleChange: (key: string) => void;
  onProductLineChange: (id: string) => void;
}

/** Role, grouped by department, and a product line when the role needs one. Both come from the API. */
export function RoleFields({
  roles,
  productLines,
  roleKey,
  productLineId,
  onRoleChange,
  onProductLineChange,
}: Props) {
  const t = useTranslations('signUp');
  const groups: { code: string | null; name: string }[] = [
    { code: null, name: t('aboveDepartments') },
    ...roles.departments,
  ];
  const needsProductLine = roles.roles.find((r) => r.key === roleKey)?.needsProductLine ?? false;

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="role">{t('role')}</Label>
        <select
          id="role"
          required
          className={selectClass}
          value={roleKey}
          onChange={(e) => onRoleChange(e.target.value)}
        >
          <option value="" disabled>
            {t('chooseRole')}
          </option>
          {groups.map((group) => (
            <optgroup key={group.code ?? 'above'} label={group.name}>
              {roles.roles
                .filter((r) => r.departmentCode === group.code)
                .map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>

      {needsProductLine && (
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
            {productLines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
