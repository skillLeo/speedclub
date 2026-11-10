import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming, ReduceMotion } from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useVehicle } from '@/api/queries/garage';
import { useQrSvg } from '@/api/queries/qr';
import { displayQrCode, displayQrUrl } from '@/features/qr/code';
import { paramOf } from '@/features/vehicle/navigation';
import { haptics } from '@/lib/haptics';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, motion as motionTokens, size, space, useBreakpoint, useMotion } from '@/theme';
import { AppWordmark } from '@/features/auth/AppWordmark';
import { Button, Header, OfflineBanner, QRDisplay, Screen, Skeleton, SkeletonBlock, SkeletonText, Text } from '@/ui';

import { CentredState, GoneState, LoadErrorState, SignInState, useGarageAccess } from '../components/frames';
import { isGone } from '../errors';
import { useCloseModal } from '../navigation';

const ROUTE = 'GAR-04';
const EDGES: readonly Edge[] = ['left', 'right', 'bottom'];
const WORDMARK_WIDTH = 160;
const COLUMN_MAX = size.qrMaxOnScreen + 2 * space[24];

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingBottom: t.space[32], paddingTop: t.space[8] },
  column: { alignItems: 'center', alignSelf: 'center', maxWidth: COLUMN_MAX, width: '100%' },
  mark: { alignItems: 'center', gap: t.space[12] },
  rule: { backgroundColor: t.color.accent.fg, height: t.size.border.control, transformOrigin: 'left', width: WORDMARK_WIDTH },
  title: { marginTop: t.space[32], textAlign: 'center' },
  body: { marginTop: t.space[8], textAlign: 'center' },
  cardBox: { alignSelf: 'stretch', marginTop: t.space[24], overflow: 'hidden' },
  wipe: { backgroundColor: t.color.qr.bg, borderRadius: t.radius.lg, pointerEvents: 'none' },
  actions: { alignSelf: 'stretch', gap: t.space[12], marginTop: t.space[32] },
  skeletonCard: { alignSelf: 'stretch', marginTop: t.space[24] },
}));

/**
 * The print of §10: one 600 ms mask wipe uncovers the code top to bottom, then the 1-px accent rule draws under the
 * wordmark. Reduced motion: a 120 ms crossfade, the rule simply there.
 */
function usePrint(ready: boolean) {
  const motion = useMotion();
  const [height, setHeight] = useState(0);
  const wipe = useSharedValue(0);
  const rule = useSharedValue(0);
  const fade = useSharedValue(motion.reduced ? 0 : 1);

  useEffect(() => {
    if (!ready || height === 0) return;
    if (!motion.enabled) {
      wipe.set(1);
      rule.set(1);
      fade.set(1);
      return;
    }
    if (motion.reduced) {
      wipe.set(1);
      rule.set(1);
      fade.set(motion.timingTo(1, 'reducedCrossfade'));
    } else {
      wipe.set(withTiming(1, { duration: motionTokens.duration.qrReveal, easing: motion.easing.standard, reduceMotion: ReduceMotion.Never }));
      rule.set(
        withDelay(
          motionTokens.duration.qrReveal,
          withTiming(1, { duration: motionTokens.duration.medium, easing: motion.easing.decelerate, reduceMotion: ReduceMotion.Never }),
        ),
      );
    }
    haptics.success();
  }, [fade, height, motion, ready, rule, wipe]);

  const maskStyle = useAnimatedStyle(() => ({ transform: [{ translateY: wipe.get() * height }] }));
  const ruleStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: rule.get() }] }));
  const cardStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));
  return { maskStyle, ruleStyle, cardStyle, onLayout: (event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height) };
}

/** GAR-04, the brand moment after publishing (§2): the QR code "prints", then the next steps. */
export function PublishedScreen() {
  const { t } = useTranslation('garage');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const qaState = useQaState();
  const close = useCloseModal();
  const access = useGarageAccess();
  const { gutter } = useBreakpoint();
  const params = useLocalSearchParams<{ vehicleId: string }>();
  const vehicleId = paramOf(params.vehicleId) ?? '';
  const query = useVehicle(vehicleId);
  const vehicle = query.data;
  const code = vehicle?.qr?.code ?? null;
  const svg = useQrSvg(vehicleId, code, qaState !== 'loading');
  const print = usePrint(Boolean(svg.data));

  /** The modal closes, then the next screen opens in the tab underneath. */
  const leaveTo = (path: string) => {
    close();
    router.push(path as never);
  };

  let body;
  if (access.status === 'guest') {
    body = <SignInState routeId={ROUTE} returnTo={`/published/${vehicleId}`} />;
  } else if (qaState === 'error' || (query.isError && !vehicle && !isGone(query.error))) {
    body = <LoadErrorState routeId={ROUTE} offline={!online} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  } else if ((query.isError && isGone(query.error)) || (vehicle && (vehicle.status !== 'published' || !code))) {
    body = <GoneState routeId={ROUTE} title={t('published.goneTitle')} body={t('published.goneBody')} />;
  }
  if (body) {
    return (
      <Screen edges={EDGES} testID={`${ROUTE}.root`}>
        <Header backIcon="close" onBack={close} testID={`${ROUTE}.header`} />
        <CentredState>{body}</CentredState>
      </Screen>
    );
  }

  const loading = qaState === 'loading' || !vehicle || !code || !svg.data;
  const title = vehicle?.full_title ?? '';

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header backIcon="close" onBack={close} testID={`${ROUTE}.header`} />
      {online ? null : <OfflineBanner testID={`${ROUTE}.offline`} />}
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}>
        <View style={styles.column}>
          <View style={styles.mark}>
            <AppWordmark width={WORDMARK_WIDTH} testID={`${ROUTE}.wordmark`} />
            <Animated.View style={[styles.rule, print.ruleStyle]} testID={`${ROUTE}.rule`} />
          </View>
          <Text variant="displayL" role="heading" {...({ 'aria-level': 1 } as object)} style={styles.title} testID={`${ROUTE}.title`}>
            {t('published.title')}
          </Text>
          <Text variant="body" color="text.secondary" style={styles.body} testID={`${ROUTE}.body`}>
            {title ? t('published.body', { vehicle: title }) : t('published.bodyFallback')}
          </Text>
          {loading ? (
            <Skeleton style={styles.skeletonCard} testID={`${ROUTE}.skeleton`}>
              <SkeletonBlock aspectRatio={1} corner="lg" />
              <SkeletonText variant="code" width="40%" />
            </Skeleton>
          ) : (
            <Animated.View style={[styles.cardBox, print.cardStyle]} onLayout={print.onLayout}>
              <QRDisplay
                svg={svg.data}
                label={t('published.qrLabel', { vehicle: title })}
                code={displayQrCode(code)}
                url={vehicle.qr ? displayQrUrl(vehicle.qr.url) : undefined}
                testID={`${ROUTE}.qr`}
              />
              <Animated.View dataSet={{ qaExempt: 'qr' }} style={[StyleSheet.absoluteFill, styles.wipe, print.maskStyle]} testID={`${ROUTE}.wipe`} />
            </Animated.View>
          )}
          <View style={styles.actions}>
            <Button
              label={t('published.addMods')}
              variant="brand"
              size="l"
              fullWidth
              disabled={!vehicle}
              onPress={() => leaveTo(`/garage/${vehicleId}/mods`)}
              testID={`${ROUTE}.addMods`}
            />
            <Button
              label={t('published.downloadSticker')}
              variant="secondary"
              size="l"
              fullWidth
              icon="download-simple"
              disabled={!vehicle}
              onPress={() => leaveTo(`/qr/${vehicleId}`)}
              testID={`${ROUTE}.sticker`}
            />
            <Button
              label={t('published.viewPage')}
              variant="tertiary"
              size="m"
              fullWidth
              disabled={!vehicle}
              onPress={() => vehicle && leaveTo(`/v/${vehicle.slug}`)}
              testID={`${ROUTE}.viewPage`}
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
