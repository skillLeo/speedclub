import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { useMemberSettings } from '@/api/queries/settings';
import { useShareCard, type ShareCard, type ShareCardFormat } from '@/api/queries/signature';
import type { PublicVehicle } from '@/api/queries/vehicles';
import { useDebouncedValue } from '@/features/auth/forms';
import { useCloseModal } from '@/features/garage/navigation';
import '@/features/score/qaScore';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ErrorState } from '@/ui/ErrorState';
import { Header } from '@/ui/Header';
import { Screen } from '@/ui/Screen';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Skeleton, SkeletonBlock } from '@/ui/Skeleton';
import { StickyCTABar } from '@/ui/StickyCTABar';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';

import { ShareCardCustomiser, ShareCardCustomiserSkeleton } from '../components/ShareCardCustomiser';
import { paramOf } from '../navigation';
import { CardSaveError, SHARE_CARD_FLAG, SHARE_CARD_RATIO, saveCard, shareCard } from '../shareCard';
import {
  defaultShareCardOptions,
  isDefaultShareCard,
  resetShareCard,
  shareCardChoices,
  shareCardSearch,
  shareCardTextProblem,
  type ShareCardOptions,
} from '../shareCardOptions';

const ROUTE = 'VEH-07';
/** The sticky bar pads the bottom safe area itself. */
const EDGES: readonly Edge[] = ['left', 'right'];
const EDGES_PLAIN: readonly Edge[] = ['left', 'right', 'bottom'];
/** CF-6: a card is drawn once the choices have settled, not on every tap of a row of toggles. */
const SETTLE_MS = 400;
/** The story preview stays in view on a phone: at most 480 high. */
const PREVIEW_MAX_HEIGHT = (layout.feedColumn * 3) / 4;
/** From a tablet on, the card stays beside its choices: this share of the page. */
const PREVIEW_PANE = '42%';
/** R5DQ-03: beside the card the crop stage is at most this share of the card preview's height. */
const CROP_TO_PREVIEW = 0.6;

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: t.space[32], paddingTop: t.space[16] },
  column: { alignSelf: 'center', gap: t.space[16], maxWidth: layout.feedColumn, width: '100%' },
  panes: { alignSelf: 'center', columnGap: t.space[48], flex: 1, flexDirection: 'row', maxWidth: layout.contentMax, width: '100%' },
  // react-native-web's ScrollView grows on its own: each pane is a sized View, the ScrollView fills it.
  previewPane: { width: PREVIEW_PANE },
  choicesPane: { flex: 1 },
  paneScroll: { flex: 1 },
  // R5DQ-07: as on the phone, the primary with a text action beside it (they wrap at a large font).
  inlineActions: { alignItems: 'center', columnGap: t.space[8], flexDirection: 'row', flexWrap: 'wrap', rowGap: t.space[4] },
  inlinePrimary: { flexBasis: '50%', flexGrow: 1, flexShrink: 1, minWidth: 0 },
  paneColumn: { gap: t.space[16] },
  // DQ-P5-055: the card's own outline. Its ground may be exactly the canvas (Dunkel on Carbon, Hell on Hell), and the card must still
  // read as one picture. The drawn PNG is unchanged.
  frame: {
    alignSelf: 'center',
    borderColor: t.color.border.default,
    borderRadius: t.radius.md,
    borderWidth: t.size.border.control,
    overflow: 'hidden',
    width: '100%',
  },
  card: { backgroundColor: t.color.bg.raised, width: '100%' },
  state: { alignItems: 'center', backgroundColor: t.color.bg.surface, flex: 1, justifyContent: 'center', padding: t.space[16] },
  divider: { backgroundColor: t.color.border.hairline, height: t.size.border.control },
}));

/** The build as this device has read it, for any viewer: VEH-01 opens the card, so its page is in the cache. */
function useCachedVehicle(vehicleId: string): PublicVehicle | null {
  const client = useQueryClient();
  for (const [, data] of client.getQueriesData<PublicVehicle>({ queryKey: ['public-vehicle'] })) {
    if (data && typeof data === 'object' && 'id' in data && data.id === vehicleId) return data;
  }
  return null;
}

/**
 * M5.9d (contract §6): what the server draws on the card besides photo and specs, as one line under the preview: the Build Score
 * with its stage, the Dex number, the QR code.
 */
export function shareCardContents(
  t: (key: string, options?: Record<string, unknown>) => string,
  score: { total: number; stage: number } | null,
  dexNumber: string | null,
  number: (value: number) => string,
): string {
  const items = [
    score ? t('shareCard.contentScore', { score: number(score.total), stage: score.stage }) : null,
    dexNumber ? t('shareCard.contentDex', { number: dexNumber }) : null,
    t('shareCard.contentQr'),
  ].filter((item): item is string => item !== null);
  return t('shareCard.contents', { items: items.join(' · ') });
}

/** The server's 422 message on `text`, when the card refused the member's own line. */
export function textErrorOf(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const messages = error.fieldErrors.text;
  return messages && messages.length > 0 ? messages.join(' ') : null;
}

/**
 * The PNG at its exact aspect, never cropped (contract rule 5: `contentFit` contain). While the next drawing is on its way the last
 * card of this format stays (the line under it says it is being drawn), so the preview never jumps to a skeleton on every tap.
 */
function CardImage({ card, ratio, label, drawing }: { card: ShareCard; ratio: number; label: string; drawing: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.card, { aspectRatio: ratio }]} aria-busy={drawing} testID={`${ROUTE}.preview`}>
      <Image
        source={{ uri: card.url }}
        // R7-4b: a new card is a new picture, never a crossfade over the last one. On the web expo-image keeps the previous <img> under
        // the new one until the new one reports `load`, and drops a new one that errors: WebKit (the client's iPhone) went on showing
        // the card with the switched-off line. A new recycling key per card clears the old picture at once.
        recyclingKey={card.url}
        contentFit="contain"
        draggable={false}
        accessible
        alt={label}
        accessibilityLabel={label}
        style={StyleSheet.absoluteFill}
        testID={`${ROUTE}.preview.image`}
      />
    </View>
  );
}

/**
 * VEH-07 (modals)/share-card/[vehicleId] [SIG `sig.share_cards`]: the card as a story 9:16 or a square 1:1, made from a template, a
 * photo and its crop, what it shows and an own line (R5-2e), then shared or saved (the web downloads it, the apps put it into the
 * photo library).
 */
export function ShareCardScreen() {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const params = useLocalSearchParams<{ vehicleId: string }>();
  const vehicleId = paramOf(params.vehicleId) ?? '';
  const enabled = useFlag(SHARE_CARD_FLAG);
  const qaState = useQaState();
  const online = useOnline();
  const close = useCloseModal('/discover');
  const { gutter, kind } = useBreakpoint();
  const wide = kind !== 'phone';
  const cached = useCachedVehicle(vehicleId);
  const title = cached?.full_title ?? null;
  const settings = useMemberSettings();
  // CF-6: what this build can put on a card; the owner's page always names them, so their own setting decides about @username.
  const ownerShows = cached?.is_owner ? (settings.data?.show_owner_on_qr ?? null) : null;
  const choices = useMemo(() => shareCardChoices(cached, ownerShows), [cached, ownerShows]);
  const [options, setOptions] = useState<ShareCardOptions>(() => defaultShareCardOptions('story'));
  const settled = useDebouncedValue(options, SETTLE_MS);
  const format = settled.format;
  // "Standard" also clears an own line the field refuses.
  const isDefault = isDefaultShareCard(options, choices) && options.text.trim() === '';
  // The default card is the stored PNG; any other choice is drawn for this viewer with its options (no stored file).
  const search = isDefaultShareCard(settled, choices) ? null : shareCardSearch(settled, choices);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);
  const [previewHeight, setPreviewHeight] = useState(0);
  const card = useShareCard(vehicleId, format, enabled, search);
  const textError = textErrorOf(card.error);
  const textProblem = shareCardTextProblem(options.text) !== null;
  const drawing = options !== settled || card.isFetching;
  const ratio = SHARE_CARD_RATIO[options.format];
  const formatLabel = t(`shareCard.formats.${options.format}`);
  const gone = card.error instanceof ApiError && card.error.status === 404;

  // The last card of each format, shown while the next one is drawn and when the server refused the own line.
  const [lastCard, setLastCard] = useState<Partial<Record<ShareCardFormat, ShareCard>>>({});
  const drawn = card.data;
  // Adjusted while rendering (react.dev "storing information from previous renders"), not in an effect.
  if (drawn && lastCard[format] !== drawn) setLastCard({ ...lastCard, [format]: drawn });
  const shown = format === options.format ? (drawn ?? lastCard[format] ?? null) : null;
  const ready = Boolean(card.data) && !drawing && !textProblem && textError === null;

  const run = async (action: 'share' | 'save') => {
    if (!card.data) return;
    setBusy(action);
    try {
      const outcome = action === 'save' ? await saveCard(card.data) : await shareCard(card.data, title ?? t('shareCard.title'));
      if (outcome === 'saved') {
        toast(isWeb ? t('shareCard.saved', { file: card.data.fileName }) : t('shareCard.savedToPhotos'), { haptic: 'success', testID: `${ROUTE}.toast` });
      }
    } catch (error) {
      if (error instanceof CardSaveError && error.reason === 'denied') {
        toast(t('shareCard.saveDenied'), { action: { label: t('shareCard.openSettings'), onPress: () => void Linking.openSettings() }, testID: `${ROUTE}.toast` });
      } else if (error instanceof CardSaveError) {
        toast(t('shareCard.saveFailed'), { testID: `${ROUTE}.toast` });
      } else {
        toast(error instanceof ApiError && error.code === 'sharing_unavailable' ? error.message : t('shareCard.shareFailed'), { testID: `${ROUTE}.toast` });
      }
    } finally {
      setBusy(null);
    }
  };

  const previewLabel = t('shareCard.previewLabel', { vehicle: title ?? '', format: formatLabel });
  let preview: ReactNode;
  if (qaState === 'default' && shown && (card.data || drawing || textError !== null)) {
    preview = <CardImage card={shown} ratio={ratio} label={previewLabel} drawing={drawing} />;
  } else if (qaState === 'loading' || drawing || (enabled && card.isPending && card.fetchStatus === 'fetching')) {
    preview = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <SkeletonBlock width="100%" aspectRatio={ratio} corner="none" />
      </Skeleton>
    );
  } else {
    const offline = !online || card.fetchStatus === 'paused' || qaState === 'offline';
    preview = (
      <View style={[styles.state, { aspectRatio: ratio }]}>
        <ErrorState
          title={offline ? t('error.offlineTitle') : t('shareCard.errorTitle')}
          message={offline ? t('error.offlineBody') : undefined}
          onRetry={() => void card.refetch()}
          retrying={card.isFetching}
          testID={`${ROUTE}.error`}
        />
      </View>
    );
  }

  const unavailable = !enabled || qaState === 'empty' || gone || vehicleId === '';

  const formatPicker = (
    <SegmentedControl
      options={[
        { value: 'story', label: t('shareCard.formats.story') },
        { value: 'square', label: t('shareCard.formats.square') },
      ]}
      value={options.format}
      onChange={(next: ShareCardFormat) => setOptions((current) => ({ ...current, format: next }))}
      label={t('shareCard.format')}
      role="radiogroup"
      labelVariant="labelControl"
      testID={`${ROUTE}.format`}
    />
  );
  const previewBlock = (
    <>
      <View
        style={[styles.frame, { maxWidth: PREVIEW_MAX_HEIGHT * ratio }]}
        onLayout={(event) => {
          const next = Math.round(event.nativeEvent.layout.height);
          setPreviewHeight((current) => (current === next ? current : next));
        }}
      >
        {preview}
      </View>
      <Text variant="callout" color="text.secondary" aria-live="polite" testID={`${ROUTE}.hint`}>
        {shown && drawing ? t('shareCard.drawing') : t(options.format === 'square' ? 'shareCard.hintSquare' : 'shareCard.hint')}
      </Text>
    </>
  );
  // A cold link has no page in the cache to read the choices from: it shares the default card.
  const customiser = qaState === 'loading' ? (
    <ShareCardCustomiserSkeleton format={options.format} routeId={ROUTE} />
  ) : cached ? (
    <ShareCardCustomiser
      options={options}
      choices={choices}
      onChange={setOptions}
      isDefault={isDefault}
      onReset={() => setOptions((current) => resetShareCard(current))}
      username={cached.owner?.username ?? null}
      textError={textError}
      maxCropHeight={wide && previewHeight > 0 ? previewHeight * CROP_TO_PREVIEW : undefined}
      disabled={!online}
      routeId={ROUTE}
    />
  ) : null;

  let body: ReactNode;
  if (unavailable) {
    body = (
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}>
        <View style={styles.column}>
          <EmptyState icon="image" title={t('shareCard.unavailableTitle')} body={t('shareCard.unavailableBody')} testID={`${ROUTE}.unavailable`} />
        </View>
      </ScrollView>
    );
  } else if (wide) {
    body = (
      <View style={[styles.panes, { paddingHorizontal: gutter }]}>
        <View style={styles.previewPane}>
          <ScrollView style={styles.paneScroll} contentContainerStyle={[styles.content, styles.paneColumn]} testID={`${ROUTE}.previewPane`}>
            {formatPicker}
            {previewBlock}
            {/* Beside the choices the actions stay with the card; a full-width bar would stretch "Teilen" across the page. */}
            <View style={styles.inlineActions}>
              <Button label={t('shareCard.share')} icon="share-network" size="l" disabled={!ready || busy !== null} loading={busy === 'share'} onPress={() => void run('share')} style={styles.inlinePrimary} testID={`${ROUTE}.cta.primary`} />
              <Button label={t('shareCard.save')} icon="download-simple" variant="tertiary" size="l" disabled={!ready || busy !== null} loading={busy === 'save'} onPress={() => void run('save')} testID={`${ROUTE}.save`} />
            </View>
          </ScrollView>
        </View>
        <View style={styles.choicesPane}>
          <ScrollView style={styles.paneScroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID={`${ROUTE}.choicesPane`}>
            {customiser}
          </ScrollView>
        </View>
      </View>
    );
  } else {
    body = (
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]} keyboardShouldPersistTaps="handled">
        <View style={styles.column}>
          {formatPicker}
          {previewBlock}
          {customiser ? <View style={styles.divider} /> : null}
          {customiser}
        </View>
      </ScrollView>
    );
  }

  return (
    <Screen edges={unavailable || wide ? EDGES_PLAIN : EDGES} testID={`${ROUTE}.root`}>
      <Header backIcon="close" onBack={close} title={t('shareCard.title')} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner />
      {body}
      {unavailable || wide ? null : (
        <StickyCTABar
          label={t('shareCard.share')}
          onPress={() => void run('share')}
          loading={busy === 'share'}
          disabled={!ready || busy !== null}
          secondary={{ label: t('shareCard.save'), onPress: () => void run('save'), disabled: !ready || busy !== null, loading: busy === 'save', testID: `${ROUTE}.save` }}
          testID={`${ROUTE}.cta`}
        />
      )}
    </Screen>
  );
}
