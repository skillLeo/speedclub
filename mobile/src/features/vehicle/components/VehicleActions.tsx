import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useFlag } from '@/api/queries/appConfig';
import { useSaveBuild } from '@/api/queries/social';
import { SOCIAL_FLAGS, useVehicleFollow } from '@/api/queries/social2';
import { readPublicVehicleNow, type PublicVehicle } from '@/api/queries/vehicles';
import { SaveSheet } from '@/features/collections/components/SaveSheet';
import { newMessageHref } from '@/features/messages/entry';
import { FollowButton as MemberFollowButton } from '@/features/profile/components/FollowButton';
import { useViewAsLock } from '@/features/viewAs/useViewAs';
import { hapticFor } from '@/lib/haptics';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles } from '@/theme';
import { Button, Icon, PressableScale, Text, toast, type IconName } from '@/ui';
import { useStacksAtFontScale } from '@/ui/rowParts';
import { FollowButton } from '@/ui/motion/kit';

import { SAVE_ICON, SAVED_BUILDS_FLAG } from '../save';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[8] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  tile: { flexBasis: 0, flexGrow: 1, minHeight: t.size.button.l },
  tileStacked: { flexBasis: '100%' },
  tileVisual: {
    alignItems: 'center',
    backgroundColor: t.color.bg.raised,
    borderColor: t.color.border.default,
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    flexGrow: 1,
    gap: t.space[2],
    justifyContent: 'center',
    minHeight: t.size.button.l,
    paddingHorizontal: t.space[4],
    paddingVertical: t.space[8],
  },
  tileVisualStacked: { flexDirection: 'row', gap: t.space[8] },
  tileLabel: { textAlign: 'center' },
}));

type TileProps = {
  icon: IconName;
  label: string;
  /** Screen-reader name when it needs more than the label; it always starts with the label (WCAG 2.5.3). */
  name?: string;
  onPress: () => void;
  onLongPress?: () => void;
  pressed?: boolean;
  disabled?: boolean;
  locked?: string | null;
  testID: string;
};

/**
 * One of the equal tonal actions under "Folgen" (09 §7.6 (4)): glyph over a one-word label, so three German labels fit one row
 * of a phone; from the large-text threshold each takes a row of its own with the glyph beside the label.
 */
function ActionTile({ icon, label, name, onPress, onLongPress, pressed, disabled, locked, testID }: TileProps) {
  const styles = useStyles();
  const stacked = useStacksAtFontScale();
  return (
    <PressableScale
      role="button"
      aria-label={name ?? label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      aria-disabled={disabled || Boolean(locked) || undefined}
      disabled={disabled || undefined}
      onPress={() => {
        if (locked) {
          toast(locked, { testID: `${testID}.locked` });
          return;
        }
        onPress();
      }}
      {...(onLongPress && !locked && !disabled ? { onLongPress } : {})}
      style={[styles.tile, stacked ? styles.tileStacked : null]}
      contentStyle={[styles.tileVisual, stacked ? styles.tileVisualStacked : null]}
      testID={testID}
    >
      <Icon name={icon} size={20} weight={pressed ? 'fill' : 'regular'} color={disabled ? 'text.tertiary' : 'text.primary'} />
      <Text variant="callout" color={disabled ? 'text.tertiary' : 'text.primary'} hyphenate={false} style={styles.tileLabel} selectable={false}>
        {label}
      </Text>
    </PressableScale>
  );
}


export type VehicleActionsProps = {
  vehicle: PublicVehicle;
  routeId: string;
  onShare: () => void;
  sharing: boolean;
};

/**
 * VEH-01 action row for a visitor (09 §7.6 (4), DQ-972): "Folgen" is the one filled CTA — the build follow (09 §8.6), or the
 * owner when the build-follow flag is off — then Speichern, Teilen and Nachricht (when the owner allows it) as equal tonal
 * buttons with labels. Speichern saves into "Gespeichert" with one tap (ADR-436 a); the toast and a long press open the
 * collection sheet. A guest gets each control too; it asks to sign in and brings them back here.
 */
export function VehicleActions({ vehicle, routeId, onShare, sharing }: VehicleActionsProps) {
  const { t } = useTranslation('vehicle');
  const { t: tProfile } = useTranslation('profile');
  const styles = useStyles();
  const router = useRouter();
  const pathname = usePathname();
  const client = useQueryClient();
  const requireAuth = useRequireAuth();
  const status = useSessionStore((state) => state.status);
  const member = status === 'member';
  const writeLock = useViewAsLock();
  const messageLock = useViewAsLock('messages');
  const followFlag = useFlag(SOCIAL_FLAGS.follow);
  const collectionsFlag = useFlag(SOCIAL_FLAGS.collections);
  const savedFlag = useFlag(SAVED_BUILDS_FLAG);
  const follow = useVehicleFollow(vehicle.id);
  const save = useSaveBuild(vehicle.id);
  const [sheet, setSheet] = useState(false);
  const owner = vehicle.owner;
  const askToSignIn = () => requireAuth(undefined, { returnTo: pathname });

  // -- Folgen
  const following = vehicle.social?.is_following === true;
  const toggleFollow = () => {
    if (!member) {
      askToSignIn();
      return;
    }
    if (writeLock) {
      toast(writeLock, { testID: `${routeId}.followToast` });
      return;
    }
    hapticFor('follow');
    const next = !following;
    follow.mutate(next, {
      onSuccess: () =>
        toast(next ? t('follow.followed') : t('follow.unfollowed'), { testID: `${routeId}.followToast` }),
      onError: (error) =>
        toast(error.message || t('follow.failed'), { haptic: 'warning', testID: `${routeId}.followToast` }),
    });
  };
  let followControl;
  if (followFlag && (!member || typeof vehicle.social?.is_following === 'boolean')) {
    followControl = (
      <FollowButton
        following={member && following}
        onToggle={toggleFollow}
        followLabel={t('actions.followBuild')}
        followingLabel={t('actions.followingBuild')}
        itemKey={vehicle.id}
        fullWidth
        testID={`${routeId}.actions.follow`}
      />
    );
  } else if (member && owner?.username) {
    // Without the build follow: the owner, as in M2.1.
    followControl = (
      <MemberFollowButton
        username={owner.username}
        following={owner.is_following}
        variant="primary"
        name={owner.display_name || `@${owner.username}`}
        testID={`${routeId}.actions.follow`}
      />
    );
  } else if (owner) {
    followControl = (
      <Button
        label={tProfile('follow.follow')}
        variant="primary"
        size="m"
        fullWidth
        onPress={askToSignIn}
        testID={`${routeId}.actions.follow`}
      />
    );
  }

  // -- Speichern
  const showSave = savedFlag || collectionsFlag;
  const saved = member && vehicle.is_saved === true;
  const sendSave = (next: boolean) => {
    hapticFor('save');
    save.mutate(
      { vehicleId: vehicle.id, save: next },
      {
        onSuccess: () =>
          toast(next ? t('save.saved') : t('save.removed'), {
            testID: `${routeId}.saveToast`,
            ...(next && collectionsFlag
              ? { action: { label: t('save.chooseCollection'), onPress: () => setSheet(true) } }
              : {}),
          }),
        onError: (error) =>
          toast(error.message || t('save.failed'), { haptic: 'warning', testID: `${routeId}.saveToast` }),
      },
    );
  };
  const toggleSave = () => {
    if (useSessionStore.getState().status === 'member') {
      sendSave(!saved);
      return;
    }
    requireAuth(
      () => {
        void readPublicVehicleNow(client, vehicle.slug)
          .then((fresh) => {
            if (fresh.is_owner || fresh.owner?.is_self || fresh.is_saved !== false) return;
            sendSave(true);
          })
          .catch(() => undefined);
      },
      { returnTo: pathname },
    );
  };
  const openCollections = () => {
    if (!member) {
      askToSignIn();
      return;
    }
    hapticFor('longPressMenu');
    setSheet(true);
  };

  // -- Nachricht
  const canMessage = owner !== null && owner !== undefined && (!member || owner.can_message === true);
  const writeToOwner = () =>
    member
      ? router.push(newMessageHref({ to: owner?.username ?? undefined, about: vehicle.slug }))
      : askToSignIn();

  return (
    <View style={styles.root} role="toolbar" aria-label={t('actions.rowLabel')} testID={`${routeId}.actions`}>
      {followControl}
      <View style={styles.row}>
        {showSave ? (
          <ActionTile
            icon={SAVE_ICON}
            // DQ-1058: the label says the state ("Gespeichert"), with aria-pressed and the filled glyph; the name is the label.
            label={saved ? t('actions.savedShort') : t('actions.saveShort')}
            onPress={toggleSave}
            onLongPress={openCollections}
            pressed={saved}
            locked={writeLock}
            testID={`${routeId}.save`}
          />
        ) : null}
        <ActionTile icon="share-network" label={t('actions.share')} onPress={onShare} disabled={sharing} testID={`${routeId}.share`} />
        {canMessage ? (
          <ActionTile
            icon="chat-circle"
            label={t('actions.message')}
            onPress={writeToOwner}
            locked={member ? messageLock : null}
            testID={`${routeId}.actions.message`}
          />
        ) : null}
      </View>
      {member && collectionsFlag ? (
        <SaveSheet
          visible={sheet}
          onClose={() => setSheet(false)}
          item={{ type: 'vehicle', id: vehicle.id }}
          routeId={routeId}
        />
      ) : null}
    </View>
  );
}
