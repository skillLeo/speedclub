import { useTranslation } from 'react-i18next';

import type { NotificationPrefs, SettingsPatch } from '@/api/queries/settings';
import { SwitchRow } from '@/features/settings/components/SettingRows';
import { RowGroup } from '@/ui/RowGroup';

/**
 * M5.7 (10 §6.2, §6.3, §16; m5.7-contract §8.2): the two engagement types, each with its own switches. Read by name: the generated
 * prefs list them only once the server's notification part is in, and a row shows only for a type the server lists, so an older server
 * never gets a switch it cannot store.
 */
export const ENGAGEMENT_TYPES = ['plan_due', 'weekly_recap'] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];
export type EngagementChannel = 'push' | 'web_push' | 'email';

/** The contract's defaults (§8.2): both on, the recap's e-mail too. */
const DEFAULTS: Readonly<Record<EngagementType, Partial<Record<EngagementChannel, boolean>>>> = {
  plan_due: { push: true, web_push: true },
  weekly_recap: { push: true, web_push: true, email: true },
};

type Entry = Partial<Record<EngagementChannel, boolean>>;

function entryOf(prefs: NotificationPrefs, type: EngagementType): Entry | null {
  const entry = (prefs.types as unknown as Record<string, Entry | undefined>)[type];
  return entry && typeof entry === 'object' ? entry : null;
}

/** A switch's value, or null while the server does not list the type (the row is then not offered). */
export function engagementValue(prefs: NotificationPrefs, type: EngagementType, channel: EngagementChannel): boolean | null {
  const entry = entryOf(prefs, type);
  if (!entry) return null;
  const value = entry[channel] ?? (channel === 'web_push' ? entry.push : undefined) ?? DEFAULTS[type][channel];
  return typeof value === 'boolean' ? value : null;
}

/** `PATCH me/settings` for one engagement switch: only that type and channel. */
export function engagementPatch(type: EngagementType, channel: EngagementChannel, value: boolean): SettingsPatch {
  return { notification_prefs: { types: { [type]: { [channel]: value } } } } as unknown as SettingsPatch;
}

/** The groups SET-09 offers now: one per listed type, the recap with its e-mail switch. */
export function engagementGroups(prefs: NotificationPrefs, channel: 'push' | 'web_push'): { type: EngagementType; push: boolean; email: boolean | null }[] {
  return ENGAGEMENT_TYPES.flatMap((type) => {
    const push = engagementValue(prefs, type, channel);
    if (push === null) return [];
    return [{ type, push, email: type === 'weekly_recap' ? engagementValue(prefs, type, 'email') : null }];
  });
}

export type EngagementSwitchesProps = {
  prefs: NotificationPrefs;
  /** The phone's `push`, or `web_push` while this browser's notifications are on (SET-09's channel). */
  channel: 'push' | 'web_push';
  send: (patch: SettingsPatch) => void;
  disabled: boolean;
  routeId: string;
};

/**
 * SET-09 "Build-Erinnerungen" (plan_due: when a planned mod's target month arrives, at most once a week) and "Wochenrückblick"
 * (weekly_recap: Sundays at 18:00, push and e-mail, skipped when nothing happened). Each its own switch, both on by default; nothing
 * while the server does not list them yet.
 */
export function EngagementSwitches({ prefs, channel, send, disabled, routeId }: EngagementSwitchesProps) {
  const { t } = useTranslation('profile');
  const groups = engagementGroups(prefs, channel);
  return (
    <>
      {groups.map((group) => (
        <RowGroup key={group.type} title={t(`insights.notifications.${group.type}.group`)} testID={`${routeId}.${group.type}`}>
          <SwitchRow
            title={t(`insights.notifications.${group.type}.push`)}
            helper={t(`insights.notifications.${group.type}.helper`)}
            value={group.push}
            onValueChange={(next) => send(engagementPatch(group.type, channel, next))}
            disabled={disabled}
            divider={group.email !== null}
            testID={`${routeId}.push.${group.type}`}
          />
          {group.email !== null ? (
            <SwitchRow
              title={t('insights.notifications.weekly_recap.email')}
              helper={t('insights.notifications.weekly_recap.emailHelper')}
              value={group.email}
              onValueChange={(next) => send(engagementPatch(group.type, 'email', next))}
              disabled={disabled}
              testID={`${routeId}.email.${group.type}`}
            />
          ) : null}
        </RowGroup>
      ))}
    </>
  );
}
