'use client';

import { CAUSE_TYPES, DEVIATION_REASONS } from '@coal/shared';
import { useTranslations } from 'next-intl';
import { selectClass } from '@/components/role-fields';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePeople, useRoles } from '@/lib/queries';
import { todayIst } from '@/lib/format';

type Reason = (typeof DEVIATION_REASONS)[number];
type CauseType = (typeof CAUSE_TYPES)[number];

/** What a person fills in when work is late or will be: the reason, the cause and the new date. */
export interface DeviationDraft {
  reasonCode: Reason | '';
  reasonText: string;
  causeType: CauseType;
  causeUserId: string;
  causeRole: string;
  causeParty: string;
  newDate: string;
}

export const emptyDraft = (): DeviationDraft => ({
  reasonCode: '',
  reasonText: '',
  causeType: 'person',
  causeUserId: '',
  causeRole: '',
  causeParty: '',
  newDate: '',
});

export function draftComplete(d: DeviationDraft): boolean {
  const cause =
    d.causeType === 'person'
      ? d.causeUserId
      : d.causeType === 'role'
        ? d.causeRole
        : d.causeParty.trim();
  return !!d.reasonCode && d.reasonText.trim().length >= 3 && !!cause && !!d.newDate;
}

/** The fields the API takes, with only the cause that matches the chosen type. */
export function draftBody(d: DeviationDraft) {
  return {
    reasonCode: d.reasonCode as Reason,
    reasonText: d.reasonText.trim(),
    causeType: d.causeType,
    ...(d.causeType === 'person' && { causeUserId: d.causeUserId }),
    ...(d.causeType === 'role' && { causeRole: d.causeRole }),
    ...(d.causeType === 'outside' && { causeParty: d.causeParty.trim() }),
    newDate: d.newDate,
  };
}

/** The fields of the "Record why it is late" form; also used to correct a deviation. */
export function DeviationFields({
  idPrefix,
  draft,
  onChange,
}: {
  idPrefix: string;
  draft: DeviationDraft;
  onChange: (next: DeviationDraft) => void;
}) {
  const t = useTranslations('deviation');
  const people = usePeople();
  const roles = useRoles();
  const set = <K extends keyof DeviationDraft>(key: K, value: DeviationDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-reason`}>{t('reason')}</Label>
        <select
          id={`${idPrefix}-reason`}
          required
          className={selectClass}
          value={draft.reasonCode}
          onChange={(e) => set('reasonCode', e.target.value as Reason)}
        >
          <option value="" disabled>
            {t('chooseReason')}
          </option>
          {DEVIATION_REASONS.map((code) => (
            <option key={code} value={code}>
              {t(`reasons.${code}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-text`}>{t('explanation')}</Label>
        <Textarea
          id={`${idPrefix}-text`}
          required
          minLength={3}
          maxLength={1000}
          rows={2}
          value={draft.reasonText}
          onChange={(e) => set('reasonText', e.target.value)}
        />
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm leading-none font-medium">{t('causeType')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {CAUSE_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`${idPrefix}-cause-type`}
                value={type}
                checked={draft.causeType === type}
                onChange={() => set('causeType', type)}
              />
              {t(`causeTypes.${type}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {draft.causeType === 'person' && (
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-person`}>{t('person')}</Label>
          <select
            id={`${idPrefix}-person`}
            required
            className={selectClass}
            value={draft.causeUserId}
            onChange={(e) => set('causeUserId', e.target.value)}
          >
            <option value="" disabled>
              {t('choosePerson')}
            </option>
            {(people.data ?? [])
              .filter((p) => p.status === 'active')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.role.name}
                </option>
              ))}
          </select>
        </div>
      )}
      {draft.causeType === 'role' && (
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-role`}>{t('role')}</Label>
          <select
            id={`${idPrefix}-role`}
            required
            className={selectClass}
            value={draft.causeRole}
            onChange={(e) => set('causeRole', e.target.value)}
          >
            <option value="" disabled>
              {t('chooseRole')}
            </option>
            {(roles.data?.roles ?? []).map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {draft.causeType === 'outside' && (
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-party`}>{t('party')}</Label>
          <Input
            id={`${idPrefix}-party`}
            required
            maxLength={120}
            placeholder={t('partyHint')}
            value={draft.causeParty}
            onChange={(e) => set('causeParty', e.target.value)}
          />
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-date`}>{t('newDate')}</Label>
        <Input
          id={`${idPrefix}-date`}
          type="date"
          required
          min={todayIst()}
          value={draft.newDate}
          onChange={(e) => set('newDate', e.target.value)}
        />
      </div>
    </>
  );
}
