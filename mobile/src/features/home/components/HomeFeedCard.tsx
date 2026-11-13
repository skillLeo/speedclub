import { memo, useMemo } from 'react';
import { View } from 'react-native';

import type { BuildUpdateRowData, FeedVehicle } from '@/api/queries/home';
import { photoFields, variantUrl } from '@/features/profile/media';
import { keepShortNamesTogether } from '@/lib/format';
import { useFormat } from '@/lib/useFormat';
import { createStyles, size, useBreakpoint, useTheme } from '@/theme';
import { MediaCard, MediaCardSkeleton, SkeletonBlock, SkeletonText } from '@/ui';

import { useFeedCardActions } from '../feedActions';
import { parseDate } from '../model';

/**
 * The latest change a card tells: the kind, then what changed ("Fahrwerk geändert: Serie → KW V3 · −35 mm"). DQ-1031: the summary
 * starts with the system ("Abgasanlage: Serie → Remus") and the kind names it already ("Abgasanlage hinzugefügt"), so the summary's
 * system is dropped once: "Abgasanlage hinzugefügt: Serie → Remus Sportauspuff", never "…: Abgasanlage: …".
 */
export function changeCaption(change: { type_label: string; summary: string } | null | undefined): string | undefined {
  if (!change) return undefined;
  const kind = change.type_label.trim();
  const summary = withoutRepeatedKind(kind, change.summary.trim());
  if (!summary) return kind || undefined;
  // DQ-1085: a note or post is the member's own words, never prefixed by its kind ("Notiz: Bremse eingefahren" read as a system log).
  if (isAuthoredKind(kind)) return keepShortNamesTogether(summary);
  // DQ-047: a part or brand name ("HKS Hi-Power", "Spec-L") never breaks at its hyphen.
  return keepShortNamesTogether(kind ? `${kind}: ${summary}` : summary);
}

/**
 * The labels the API gives the two authored kinds (`note`, `post`; web/lang garage.update_title). Lane B gap: the row carries no `type`,
 * so the label is the only sign; with `type` on BuildUpdateRowResource this becomes `type === 'note' || type === 'post'`.
 */
const AUTHORED_KIND_LABELS: ReadonlySet<string> = new Set(['Notiz', 'Note', 'Update']); // i18n-ignore: server values, not UI copy

export function isAuthoredKind(kind: string): boolean {
  return AUTHORED_KIND_LABELS.has(kind.trim());
}

/** "Abgasanlage: Serie → Remus" under the kind "Abgasanlage hinzugefügt" → "Serie → Remus". Any other summary stays as it is. */
export function withoutRepeatedKind(kind: string, summary: string): string {
  const match = /^([^:·→]{1,40}):\s+(.+)$/su.exec(summary);
  if (!match || !kind) return summary;
  const system = (match[1] ?? '').trim().toLocaleLowerCase();
  const rest = match[2] ?? '';
  const lowerKind = kind.toLocaleLowerCase();
  const named = lowerKind === system || lowerKind.startsWith(`${system} `) || lowerKind.endsWith(` ${system}`);
  return named && rest.trim() ? rest.trim() : summary;
}

export type HomeFeedCardProps = {
  vehicle: FeedVehicle;
  /** An update of the stream: the card tells that change and opens it (VEH-05); without it, the build and its latest change. */
  update?: Pick<BuildUpdateRowData, 'id' | 'type_label' | 'summary' | 'created_at'>;
  /** DQ-289: off when the same change has a card of its own on the page. */
  showLatest?: boolean;
  /** The column the card is drawn in (edge to edge on a phone). */
  width: number;
  onOpen: (vehicle: FeedVehicle, updateId?: string) => void;
  /** PROF-02 of the owner (M2.2: owner rows open the profile). */
  onOpenOwner?: (username: string) => void;
  testID: string;
};

/**
 * 09 §7.3 feed card (MediaCard `feed`): the build's cover edge to edge on a phone, the car's name with its owner and the time in the
 * header, the change it tells as the caption. Owners who hide themselves (ADR-148 a) are not named. Badged "Beispiel"/"Editorial"
 * for sample content (09 §8.19). DQ-1025: the action row reaction · save · share (feedActions.ts; no public counts).
 */
export const HomeFeedCard = memo(function HomeFeedCard({ vehicle, update, showLatest = true, width, onOpen, onOpenOwner, testID }: HomeFeedCardProps) {
  const format = useFormat();
  const change = update ?? (showLatest ? vehicle.latest_update : null);
  const when = parseDate(update?.created_at ?? vehicle.updated_at ?? vehicle.published_at);
  const photos = useMemo(() => [{ ...photoFields(vehicle.cover, width), alt: vehicle.full_title }], [vehicle.cover, vehicle.full_title, width]);
  const owner = vehicle.owner
    ? { username: vehicle.owner.username, avatarUri: variantUrl(vehicle.owner.avatar, size.avatar.sm), avatarBlurhash: vehicle.owner.avatar?.blurhash ?? null }
    : undefined;
  const { reaction, save, onShare, sheet } = useFeedCardActions({ vehicle, updateId: update?.id, routeId: testID.split('.')[0] ?? 'HOME-01' });
  return (
    <>
    <MediaCard
      variant="feed"
      title={vehicle.full_title}
      photos={photos}
      vehicleAvatar={{ uri: variantUrl(vehicle.cover, size.avatar.sm), blurhash: vehicle.cover?.blurhash ?? null }}
      owner={owner}
      onOwnerPress={owner && onOpenOwner ? () => onOpenOwner(owner.username) : undefined}
      time={when ? format.relative(when) : ''}
      caption={changeCaption(change)}
      sample={{ is_sample: vehicle.is_sample, is_editorial: vehicle.owner?.is_editorial ?? false }}
      onPress={() => onOpen(vehicle, update?.id)}
      reaction={reaction}
      save={save}
      onShare={onShare}
      testID={testID}
    />
    {sheet}
    </>
  );
});

const useSkeletonStyles = createStyles((t) => ({
  // MediaCard `feed`: 12 between header, photo, body and actions; the owner row (min 44) 8 above the caption.
  body: { gap: t.space[8], marginTop: t.space[12] },
  owner: { alignItems: 'center', flexDirection: 'row', gap: t.space[8], minHeight: t.size.touchMin },
  actions: { flexDirection: 'row', gap: t.space[4], marginTop: t.space[12], paddingHorizontal: t.space[8] },
}));

/**
 * The feed card while it loads (DQ-984, DQ-1030): header, the 4:5 photo on the stage, the owner row (avatar 32 + handle, min 44),
 * the caption lines and the action row, so the loaded cards land where their skeletons were.
 */
export function HomeFeedCardSkeleton({ testID, actions = true }: { testID?: string; actions?: boolean }) {
  const styles = useSkeletonStyles();
  const { kind, gutter } = useBreakpoint();
  const { fontScale } = useTheme();
  // Most cards tell one change: one caption line, two once the font is large or the column narrow.
  const lines = fontScale > 1 || kind === 'phone' ? 2 : 1;
  return (
    <View testID={testID}>
      <MediaCardSkeleton variant="feed" lines={0} />
      <View style={[styles.body, { paddingHorizontal: gutter }]} testID={testID ? `${testID}.body` : undefined}>
        <View style={styles.owner}>
          <SkeletonBlock width={size.avatar.sm} height={size.avatar.sm} corner="full" />
          <SkeletonText variant="calloutStrong" width="40%" />
        </View>
        <SkeletonText variant="body" width="100%" lines={lines} lastLineWidth="60%" />
      </View>
      {actions ? (
        <View style={styles.actions}>
          <SkeletonBlock width={size.touchMin} height={size.touchMin} corner="full" />
          <SkeletonBlock width={size.touchMin} height={size.touchMin} corner="full" />
          <SkeletonBlock width={size.touchMin} height={size.touchMin} corner="full" />
        </View>
      ) : null}
    </View>
  );
}
