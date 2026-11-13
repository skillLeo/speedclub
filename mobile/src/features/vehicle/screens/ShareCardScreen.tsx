import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { useFlag } from '@/api/queries/appConfig';
import { useShareCard, type ShareCardFormat } from '@/api/queries/signature';
import type { PublicVehicle } from '@/api/queries/vehicles';
import { useCloseModal } from '@/features/garage/navigation';
import { ShellOfflineBanner } from '@/features/shell/ShellOfflineBanner';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, layout, useBreakpoint } from '@/theme';
import { Button, EmptyState, ErrorState, Header, Photo, Screen, SegmentedControl, Skeleton, SkeletonBlock, Text, toast } from '@/ui';

import { paramOf } from '../navigation';
import { SHARE_CARD_FLAG, SHARE_CARD_RATIO, saveCardOnWeb, shareCard } from '../shareCard';

const ROUTE = 'VEH-07';
const EDGES: readonly Edge[] = ['left', 'right', 'bottom'];
/** The story preview stays in view on a phone: at most 480 high. */
const PREVIEW_MAX_HEIGHT = (layout.feedColumn * 3) / 4;

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: t.space[32], paddingTop: t.space[16] },
  column: { alignSelf: 'center', gap: t.space[16], maxWidth: layout.feedColumn, width: '100%' },
  frame: { alignSelf: 'center', width: '100%' },
  state: { alignItems: 'center', backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, flex: 1, justifyContent: 'center', padding: t.space[16] },
  actions: { gap: t.space[12], marginTop: t.space[8] },
}));

/** The title of a build this device has read, for any viewer: VEH-01 opens the card, so its page is in the cache. */
function useCachedTitle(vehicleId: string): string | null {
  const client = useQueryClient();
  for (const [, data] of client.getQueriesData<PublicVehicle>({ queryKey: ['public-vehicle'] })) {
    if (data && typeof data === 'object' && 'id' in data && data.id === vehicleId) return data.full_title;
  }
  return null;
}

/** VEH-07 (modals)/share-card/[vehicleId] [SIG `sig.share_cards`]: the card as a story 9:16 or a square 1:1, then share or save. */
export function ShareCardScreen() {
  const { t } = useTranslation('vehicle');
  const styles = useStyles();
  const params = useLocalSearchParams<{ vehicleId: string }>();
  const vehicleId = paramOf(params.vehicleId) ?? '';
  const enabled = useFlag(SHARE_CARD_FLAG);
  const qaState = useQaState();
  const online = useOnline();
  const close = useCloseModal('/discover');
  const { gutter } = useBreakpoint();
  const title = useCachedTitle(vehicleId);
  const [format, setFormat] = useState<ShareCardFormat>('story');
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);
  const card = useShareCard(vehicleId, format, enabled);
  const ratio = SHARE_CARD_RATIO[format];
  const formatLabel = t(`shareCard.formats.${format}`);
  const gone = card.error instanceof ApiError && card.error.status === 404;

  const run = async (kind: 'share' | 'save') => {
    if (!card.data) return;
    setBusy(kind);
    try {
      const outcome = kind === 'save' ? await saveCardOnWeb(card.data) : await shareCard(card.data, title ?? t('shareCard.title'));
      if (outcome === 'saved') toast(t('shareCard.saved', { file: card.data.fileName }), { testID: `${ROUTE}.toast` });
    } catch (error) {
      toast(error instanceof ApiError && error.code === 'sharing_unavailable' ? error.message : t('shareCard.shareFailed'), { testID: `${ROUTE}.toast` });
    } finally {
      setBusy(null);
    }
  };

  let preview: ReactNode;
  if (qaState === 'loading' || (enabled && card.isPending && card.fetchStatus === 'fetching')) {
    preview = (
      <Skeleton testID={`${ROUTE}.skeleton`}>
        <SkeletonBlock width="100%" aspectRatio={ratio} corner="md" />
      </Skeleton>
    );
  } else if (card.data && qaState === 'default') {
    preview = (
      <Photo
        source={card.data.url}
        aspect={format === 'story' ? '9:16' : '1:1'}
        corner="md"
        label={t('shareCard.previewLabel', { vehicle: title ?? '', format: formatLabel })}
        testID={`${ROUTE}.preview`}
      />
    );
  } else {
    const offline = !online || card.fetchStatus === 'paused';
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

  let body: ReactNode;
  if (!enabled || qaState === 'empty' || gone || vehicleId === '') {
    body = <EmptyState icon="image" title={t('shareCard.unavailableTitle')} body={t('shareCard.unavailableBody')} testID={`${ROUTE}.unavailable`} />;
  } else {
    body = (
      <>
        <SegmentedControl
          options={[
            { value: 'story', label: t('shareCard.formats.story') },
            { value: 'square', label: t('shareCard.formats.square') },
          ]}
          value={format}
          onChange={setFormat}
          label={t('shareCard.format')}
          role="radiogroup"
          testID={`${ROUTE}.format`}
        />
        <View style={[styles.frame, { maxWidth: PREVIEW_MAX_HEIGHT * ratio }]}>{preview}</View>
        <Text variant="callout" color="text.secondary" testID={`${ROUTE}.hint`}>
          {t('shareCard.hint')}
        </Text>
        <View style={styles.actions}>
          <Button
            label={t('shareCard.share')}
            icon="share-network"
            size="l"
            fullWidth
            disabled={!card.data || busy !== null}
            loading={busy === 'share'}
            onPress={() => void run('share')}
            testID={`${ROUTE}.share`}
          />
          {isWeb ? (
            <Button
              label={t('shareCard.save')}
              icon="download-simple"
              variant="secondary"
              size="l"
              fullWidth
              disabled={!card.data || busy !== null}
              loading={busy === 'save'}
              onPress={() => void run('save')}
              testID={`${ROUTE}.save`}
            />
          ) : null}
        </View>
      </>
    );
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header backIcon="close" onBack={close} title={t('shareCard.title')} testID={`${ROUTE}.header`} />
      <ShellOfflineBanner />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}>
        <View style={styles.column}>{body}</View>
      </ScrollView>
    </Screen>
  );
}
