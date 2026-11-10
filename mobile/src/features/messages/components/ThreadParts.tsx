import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { photoFields } from '@/features/profile/media';
import { DecisionLink } from '@/features/safety/components/DecisionLink';
import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { createStyles, size } from '@/theme';
import { Button, Hairline, Photo, PressableScale, Skeleton, SkeletonBlock, SkeletonText, Text } from '@/ui';

import type { ChatVehicle } from '../model';

const useStyles = createStyles((t) => ({
  context: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], paddingVertical: t.space[8] },
  contextThumb: { width: t.size.thumb.row },
  contextText: { flex: 1, minWidth: 0 },
  day: { alignItems: 'center', paddingBottom: t.space[4], paddingTop: t.space[16] },
  typing: { paddingTop: t.space[8] },
  banner: { backgroundColor: t.color.bg.surface, gap: t.space[8], paddingVertical: t.space[16] },
  bannerActions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], marginTop: t.space[8] },
  note: { paddingVertical: t.space[12] },
  skeleton: { gap: t.space[12], paddingTop: t.space[16] },
  skeletonRow: { alignItems: 'flex-start' },
  skeletonOwn: { alignItems: 'flex-end' },
}));

export type ContextCardProps = {
  vehicle: ChatVehicle;
  gutter: number;
  onOpen: (vehicle: ChatVehicle) => void;
  testID: string;
};

/** FS-7 vehicle context, pinned under the header: thumb 56, "Nissan Skyline GT-R R34", "Fahrzeug von @lukas.sc". */
export function ContextCard({ vehicle, gutter, onOpen, testID }: ContextCardProps) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  return (
    <View testID={testID}>
      <PressableScale
        role="link"
        // For native. On web the title and "Fahrzeug von @…" on the card name the link, as voice control sees them (WCAG 2.5.3).
        aria-label={isWeb ? undefined : t('thread.contextOpen', { title: vehicle.title })}
        onPress={() => onOpen(vehicle)}
        feedback={false}
        contentStyle={[styles.context, { paddingHorizontal: gutter }]}
        testID={`${testID}.open`}
      >
        <View style={styles.contextThumb}>
          <Photo aspect="1:1" corner="sm" {...photoFields(vehicle.cover, size.thumb.row)} />
        </View>
        <View style={styles.contextText}>
          <Text variant="bodyStrong" hyphenate={false} numberOfLines={2}>
            {keepNameTogether(vehicle.title)}
          </Text>
          {vehicle.ownerUsername ? (
            <Text variant="supporting" color="text.secondary" hyphenate={false} numberOfLines={1}>
              {t('thread.contextOwner', { username: vehicle.ownerUsername })}
            </Text>
          ) : null}
        </View>
      </PressableScale>
      <Hairline />
    </View>
  );
}

/** "Heute", "Gestern", "Di., 3. Nov.": `caption` tertiary, centred. */
export function DaySeparator({ label, testID }: { label: string; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.day} testID={testID}>
      <Text variant="caption" color="text.tertiary" role="heading">
        {label}
      </Text>
    </View>
  );
}

/**
 * [SIG] typing: a quiet line where the next message will appear. Static on purpose (§10: nothing loops but the skeleton); it is
 * announced politely once.
 */
export function TypingIndicator({ name, testID }: { name: string; testID: string }) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  return (
    <View style={styles.typing} aria-live="polite" testID={testID}>
      <Text variant="caption" color="text.tertiary">
        {`${t('thread.typing', { name })} …`}
      </Text>
    </View>
  );
}

export type RequestBannerProps = {
  /** Null for a request whose sender's account is gone: then only "Löschen" (review 13). */
  username: string | null;
  name: string;
  gutter: number;
  busy: 'accept' | 'decline' | null;
  onAccept: () => void;
  onDecline: () => void;
  onBlock: () => void;
  /** M2.6: "Blockieren und melden" instead of "Blockieren" once the report flow is there. */
  blockLabel?: string;
  testID: string;
};

/** FS-7 request mode: "@max.e46 möchte dir schreiben" + Annehmen (primary M) · Löschen (secondary M) · Blockieren (destructive tertiary). */
export function RequestBanner({ username, name, gutter, busy, onAccept, onDecline, onBlock, blockLabel, testID }: RequestBannerProps) {
  const { t } = useTranslation('messages');
  const styles = useStyles();
  return (
    <View testID={testID}>
      <View style={[styles.banner, { paddingHorizontal: gutter }]}>
        <Text variant="bodyStrong" role="heading" hyphenate={false} testID={`${testID}.title`}>
          {username ? t('request.banner', { username }) : t('request.bannerDeleted')}
        </Text>
        <Text variant="supporting" color="text.secondary">
          {username ? t('request.body', { name }) : t('request.bodyDeleted')}
        </Text>
        <View style={styles.bannerActions}>
          {username ? (
            <Button label={t('request.accept')} size="m" loading={busy === 'accept'} disabled={busy !== null} onPress={onAccept} testID={`${testID}.accept`} />
          ) : null}
          <Button
            label={t('request.decline')}
            variant="secondary"
            size="m"
            loading={busy === 'decline'}
            disabled={busy !== null}
            onPress={onDecline}
            testID={`${testID}.decline`}
          />
        </View>
        {/* DQ-417: the text action on its own line, its label on the banner's left edge at every scale (DQ-110 flush). */}
        {username ? (
          <Button
            label={blockLabel ?? t('request.block')}
            variant="destructive"
            size="m"
            flush="start"
            disabled={busy !== null}
            onPress={onBlock}
            testID={`${testID}.block`}
          />
        ) : null}
      </View>
      <Hairline />
    </View>
  );
}

/** Why the composer is not there: closed, a pending request, restricted (then with its decision, M2.6). */
export function ComposerNote({ text, gutter, decisionId, testID }: { text: string; gutter: number; decisionId?: string | null; testID: string }) {
  const styles = useStyles();
  return (
    <View testID={testID}>
      <Hairline />
      <View style={[styles.note, { paddingHorizontal: gutter }]}>
        <Text variant="supporting" color="text.secondary">
          {text}
        </Text>
        {decisionId ? <DecisionLink decisionId={decisionId} testID={`${testID}.decision`} /> : null}
      </View>
    </View>
  );
}

/** The thread's geometry while it loads: bubbles of both sides, newest at the bottom. */
export function ThreadSkeleton({ gutter, testID }: { gutter: number; testID: string }) {
  const styles = useStyles();
  const widths = ['60%', '45%', '70%', '35%', '55%'] as const;
  return (
    <Skeleton testID={testID} style={[styles.skeleton, { paddingHorizontal: gutter }]}>
      {widths.map((width, index) => (
        <View key={index} style={index % 2 === 1 ? styles.skeletonOwn : styles.skeletonRow}>
          <SkeletonBlock width={width} height={size.composerMin} corner="lg" />
        </View>
      ))}
      <SkeletonText variant="caption" width="20%" />
    </Skeleton>
  );
}
