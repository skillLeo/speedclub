import { useTranslation } from 'react-i18next';

import { useFlag } from '@/api/queries/appConfig';
import { SOCIAL_FLAGS, useSetVehicleComments, vehicleCommentsEnabled } from '@/api/queries/social2';
import type { PublicVehicle } from '@/api/queries/vehicles';
import { space } from '@/theme';
import { ListRow } from '@/ui/ListRow';
import { Switch } from '@/ui/Switch';
import { toast } from '@/ui/toast';

import { RowCard } from './RowCard';

/** Who sees the car's comments entry on VEH-01, and how (R5-5). */
export type CarCommentsEntryMode = 'hidden' | 'visitor' | 'owner';

/**
 * R5-5: the car's own thread is offered while the flag is on, to a visitor (and a guest) only while it is open
 * (`comment_thread.enabled`), to the owner always (with the switch, so they see that it is off and turn it on there). A badged
 * sample build has it too (ADR-538).
 */
export function carCommentsEntryMode(vehicle: PublicVehicle, flagOn: boolean): CarCommentsEntryMode {
  // ADR-538 (R5DQ-08): a sample build has its thread too (the seeded ones are on samples); no count either way.
  if (!flagOn) return 'hidden';
  if (vehicle.is_owner) return 'owner';
  return vehicleCommentsEnabled(vehicle) ? 'visitor' : 'hidden';
}

export type CarCommentsEntryProps = {
  vehicle: PublicVehicle;
  /** Opens the car's comments sheet (VehicleProfile holds it, so it outlives the virtualised row). */
  onOpen: () => void;
  routeId: string;
};

/**
 * R5-5 (09 §7.6 Überblick): a calm row after the description and the Highlights that opens the car's comments in the same sheet as
 * the feed card. No count, the API sends none. The owner gets "Kommentare erlauben" beside it (`PATCH vehicles/{id}/comments`); off
 * stops new comments, what was written stays readable.
 */
export function CarCommentsEntry({ vehicle, onOpen, routeId }: CarCommentsEntryProps) {
  const { t } = useTranslation('vehicle');
  const flag = useFlag(SOCIAL_FLAGS.comments);
  const mode = carCommentsEntryMode(vehicle, flag);
  const setComments = useSetVehicleComments(vehicle.id);
  if (mode === 'hidden') return null;
  // The owner's switch is their setting (`social.comments_enabled`); the thread itself is open per `comment_thread.enabled`.
  const enabled = vehicle.social ? vehicle.social.comments_enabled : vehicleCommentsEnabled(vehicle);
  const subtitle = mode === 'visitor' ? t('carComments.visitor') : enabled ? t('carComments.owner') : t('carComments.ownerOff');
  return (
    <RowCard testID={`${routeId}.commentsEntry`}>
      <ListRow
        icon="chat-circle"
        title={t('carComments.title')}
        subtitle={subtitle}
        role="button"
        chevron={false}
        onPress={onOpen}
        inset={space[16]}
        divider={mode === 'owner'}
        testID={`${routeId}.comments.open`}
      />
      {mode === 'owner' ? (
        <ListRow
          title={t('carComments.allow')}
          control={
            <Switch
              value={enabled}
              onValueChange={(next) =>
                setComments.mutate(next, {
                  onError: (error) => toast(error.message || t('carComments.toggleFailed'), { haptic: 'warning', testID: `${routeId}.toast` }),
                })
              }
              label={t('carComments.allow')}
              testID={`${routeId}.comments.allow`}
            />
          }
          inset={space[16]}
          testID={`${routeId}.comments.allowRow`}
        />
      ) : null}
    </RowCard>
  );
}
