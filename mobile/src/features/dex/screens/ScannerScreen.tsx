import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { useSubmitSpot, type SpotRefusal } from '@/api/queries/dex';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { useRequireAuth, useSessionStore } from '@/state/session';
import { createStyles, size, space, ThemeScope, useBreakpoint, useTheme } from '@/theme';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Header } from '@/ui/Header';
import { IconButton } from '@/ui/IconButton';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { PhotoStageScrim, PhotoTopScrim } from '@/ui/PhotoStageScrim';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { haptics, hapticFor } from '@/ui/motion';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { scannerAvailable } from '../availability';
import { parseStickerCode } from '../code';
import { ScannerCamera, useScannerPermission } from '../components/ScannerCamera';
import { ScanFrame } from '../components/ScanFrame';
import { LocationSheet } from '../components/LocationSheet';
import { SpotCardFace, SPOT_CARD_MAX_WIDTH } from '../components/SpotCardFace';
import { refusalCopy } from '../copy';
import { allowLocation, locationStep, resolveSpotCity, skipLocation } from '../location';
import { queueSpot, useQueuedSpotCount } from '../outbox';
import { spotRoute } from '../navigation';
import { SAMPLE_PHOTO, SAMPLE_SPOT } from '../sample';

const ROUTE = 'DEX-02';
/** On the canvas states the Header pads the top, the screen the other edges. */
const CANVAS_EDGES: readonly Edge[] = ['bottom', 'left', 'right'];

/**
 * What the scanner shows under the frame:
 *   idle      the hint; the camera reads
 *   reading   a sticker was read, the spot is on its way (reads paused)
 *   location  the first scan's location sheet is open (reads paused)
 *   foreign / refused / queued / cameraError   a calm panel with the next step
 */
type Phase =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'location'; code: string }
  | { kind: 'foreign' }
  | { kind: 'refused'; reason: SpotRefusal }
  | { kind: 'queued' };

const useStyles = createStyles((t) => ({
  // The camera is a photo: the dark stage in every theme, onPhoto text over it (ADR-421 b).
  stage: { backgroundColor: t.color.media.ground, flex: 1 },
  topScrim: { left: 0, position: 'absolute', right: 0, top: 0 },
  bar: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: t.space[8] },
  centre: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  bottom: { gap: t.space[12], paddingTop: t.space[16] },
  panel: {
    backgroundColor: t.color.scrim.photoEnd,
    borderRadius: t.radius.xl,
    gap: t.space[8],
    padding: t.space[20],
  },
  panelActions: { gap: t.space[8], marginTop: t.space[8] },
  canvasScroll: { flex: 1 },
  canvasContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: t.space[24] },
  canvasBlock: { alignSelf: 'center', maxWidth: (t.layout.feedColumn * 3) / 4, width: '100%' },
  previewCaption: { marginBottom: t.space[12] },
}));

function useClose() {
  const router = useRouter();
  return useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), [router]);
}

/** The scanner's states on the theme canvas: permission, guest, the web. A close button, then one state in a centred column. */
function CanvasState({ children, testID }: { children: ReactNode; testID: string }) {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const close = useClose();
  const online = useOnline();
  const { gutter } = useBreakpoint();
  return (
    <Screen edges={CANVAS_EDGES} testID={`${ROUTE}.root`}>
      <Header onBack={close} backIcon="close" backLabel={t('scanner.close')} testID={`${ROUTE}.header`} />
      {online ? null : <OfflineBanner label={t('scanner.offline')} testID={`${ROUTE}.offline`} />}
      <ScrollView
        style={styles.canvasScroll}
        contentContainerStyle={[styles.canvasContent, { paddingHorizontal: gutter }]}
      >
        <View style={styles.canvasBlock} testID={testID}>
          {children}
        </View>
      </ScrollView>
    </Screen>
  );
}

/** DEX-02 on the member web (ADR-508): no camera, no location; a sample of what a spot is and the way back. */
function OnlyInTheApp() {
  const { t } = useTranslation('dex');
  const { t: tCommon } = useTranslation('common');
  const styles = useStyles();
  const router = useRouter();
  const { gutter, width: windowWidth } = useBreakpoint();
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  // Before the first layout: the window less its gutters, so the card never paints wider than its column.
  const cardWidth = Math.min(width > 0 ? width : windowWidth - 2 * gutter, SPOT_CARD_MAX_WIDTH);
  return (
    <CanvasState testID={`${ROUTE}.web`}>
      <EmptyState
        title={t('scanner.web.title')}
        body={t('scanner.web.body')}
        previewPlacement="afterBody"
        preview={
          <View onLayout={onLayout} aria-hidden testID={`${ROUTE}.web.sample`}>
            <Text variant="callout" color="text.secondary" style={styles.previewCaption}>
              {t('scanner.web.preview')}
            </Text>
            {cardWidth > 0 ? (
              <SpotCardFace
                card={SAMPLE_SPOT}
                photo={SAMPLE_PHOTO}
                width={cardWidth}
                firstSpotter={false}
                sampleLabel={tCommon('badges.sample')}
                testID={`${ROUTE}.web.card`}
              />
            ) : null}
          </View>
        }
        action={{
          label: t('scanner.web.home'),
          onPress: () => router.replace('/'),
          variant: 'secondary',
          size: 'm',
        }}
        testID={`${ROUTE}.web.state`}
      />
    </CanvasState>
  );
}

/** The panel under the frame: a short title, one line, the next step. On the dark stage in every theme. */
function Panel({
  title,
  body,
  primary,
  secondary,
  testID,
}: {
  title: string;
  body?: string;
  primary?: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
  testID: string;
}) {
  const styles = useStyles();
  return (
    <View style={styles.panel} role="alert" testID={testID}>
      <Text variant="headline" color="onPhoto.primary" testID={`${testID}.title`}>
        {title}
      </Text>
      {body ? (
        <Text variant="callout" color="onPhoto.secondary" testID={`${testID}.body`}>
          {body}
        </Text>
      ) : null}
      {primary || secondary ? (
        <View style={styles.panelActions}>
          {primary ? (
            <Button
              label={primary.label}
              size="l"
              fullWidth
              onPress={primary.onPress}
              testID={`${ROUTE}.scanAgain`}
            />
          ) : null}
          {secondary ? (
            <Button
              label={secondary.label}
              variant="secondary"
              size="l"
              fullWidth
              onPress={secondary.onPress}
              testID={`${ROUTE}.done`}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function NativeScanner() {
  const { t } = useTranslation('dex');
  const styles = useStyles();
  const router = useRouter();
  const close = useClose();
  const insets = useSafeAreaInsets();
  const { gutter, width } = useBreakpoint();
  const theme = useTheme();
  const qaState = useQaState();
  const online = useOnline();
  const focused = useScreenFocused();
  const status = useSessionStore((state) => state.status);
  const requireAuth = useRequireAuth();
  const [permission, askPermission] = useScannerPermission();
  const submit = useSubmitSpot();
  const waiting = useQueuedSpotCount();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [torch, setTorch] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [centreHeight, setCentreHeight] = useState(0);
  /** A read is being handled: the stream of reads between two renders must not start a second one. */
  const busy = useRef(false);

  // Back from DEX-03: the next sticker. Until the scanner is focused again a read after the push is ignored (busy stays set).
  useEffect(() => {
    if (focused) busy.current = false;
  }, [focused]);

  const scanAgain = () => {
    busy.current = false;
    setPhase({ kind: 'idle' });
  };

  const send = async (code: string, withCity: boolean) => {
    setPhase({ kind: 'reading' });
    // The city is chosen on the device; its position never leaves resolveSpotCity (ADR-508).
    const city = withCity ? await resolveSpotCity() : null;
    try {
      const result = await submit.mutateAsync({ code, city, queue: queueSpot });
      if (result.kind === 'spotted') {
        setPhase({ kind: 'idle' });
        router.push(spotRoute(result.response.data.spot_id));
      } else if (result.kind === 'queued') {
        haptics.success();
        setPhase({ kind: 'queued' });
      } else {
        hapticFor('failedAction');
        setPhase({ kind: 'refused', reason: result.reason });
      }
    } catch {
      hapticFor('failedAction');
      setPhase({ kind: 'refused', reason: 'failed' });
    }
  };

  const onScanned = async (data: string) => {
    if (busy.current) return;
    busy.current = true;
    const code = parseStickerCode(data);
    if (!code) {
      haptics.selection();
      setPhase({ kind: 'foreign' });
      return;
    }
    // 09 §4.8: one medium haptic as the sticker is read; the reveal adds its success.
    haptics.medium();
    setPhase({ kind: 'reading' });
    const step = await locationStep();
    if (step === 'explain') {
      setPhase({ kind: 'location', code });
      return;
    }
    await send(code, step === 'granted');
  };

  const location = phase.kind === 'location' ? phase.code : null;
  const onAllowLocation = async () => {
    if (!location) return;
    const granted = await allowLocation();
    await send(location, granted);
  };
  const onSkipLocation = async () => {
    if (!location) return;
    await skipLocation();
    await send(location, false);
  };
  const onDismissLocation = () => {
    if (location) void send(location, false);
  };

  // -- States on the canvas
  if (status === 'guest') {
    return (
      <CanvasState testID={`${ROUTE}.guest`}>
        <EmptyState
          icon="qr-sticker"
          title={t('scanner.guest.title')}
          body={t('scanner.guest.body')}
          action={{
            label: t('scanner.guest.signIn'),
            onPress: () => requireAuth(undefined, { returnTo: '/scan' }),
          }}
          testID={`${ROUTE}.guest.state`}
        />
      </CanvasState>
    );
  }
  if (permission && !permission.granted && qaState === 'default') {
    return permission.canAskAgain ? (
      <CanvasState testID={`${ROUTE}.permission`}>
        <EmptyState
          icon="camera"
          title={t('scanner.permission.title')}
          body={t('scanner.permission.body')}
          action={{ label: t('scanner.permission.allow'), onPress: () => void askPermission() }}
          testID={`${ROUTE}.permission.state`}
        />
      </CanvasState>
    ) : (
      <CanvasState testID={`${ROUTE}.denied`}>
        <EmptyState
          icon="camera"
          title={t('scanner.permission.deniedTitle')}
          body={t('scanner.permission.deniedBody')}
          action={{ label: t('scanner.permission.settings'), onPress: () => void Linking.openSettings() }}
          testID={`${ROUTE}.denied.state`}
        />
      </CanvasState>
    );
  }

  // -- The camera stage: dark in every theme (the camera is a photo), its controls in the dark theme's tones.
  const scope = theme.colorScheme === 'dark' ? theme.name : 'carbon';
  const failed = cameraFailed || qaState === 'error';
  const reads = phase.kind === 'idle' && !failed;
  const showCamera = focused && permission?.granted === true && !failed && qaState !== 'loading';
  // Two gutters of air on each side, never larger than a QR is drawn (size.qrMaxOnScreen), and inside the space between bar and panel.
  const frameSide = Math.max(
    0,
    Math.min(
      width - 4 * gutter,
      size.qrMaxOnScreen,
      centreHeight > 0 ? centreHeight - 2 * gutter : size.qrMaxOnScreen,
    ),
  );

  let panel: ReactNode;
  const forced = qaState === 'restricted' ? 'restricted' : qaState === 'empty' ? 'foreign' : null;
  if (failed) {
    panel = (
      <Panel
        title={t('scanner.cameraError.title')}
        body={t('scanner.cameraError.body')}
        primary={{
          label: t('scanner.scanAgain'),
          onPress: () => {
            setCameraFailed(false);
            setCameraKey((key) => key + 1);
            scanAgain();
          },
        }}
        testID={`${ROUTE}.cameraError`}
      />
    );
  } else if (phase.kind === 'foreign' || forced === 'foreign') {
    panel = (
      <Panel
        title={t('scanner.foreign.title')}
        body={t('scanner.foreign.body')}
        primary={{ label: t('scanner.scanAgain'), onPress: scanAgain }}
        testID={`${ROUTE}.foreign`}
      />
    );
  } else if (phase.kind === 'refused' || forced === 'restricted') {
    const reason = phase.kind === 'refused' ? phase.reason : 'restricted';
    const copy = refusalCopy(t, reason);
    panel = (
      <Panel
        title={copy.title}
        body={copy.body}
        primary={{ label: t('scanner.scanAgain'), onPress: scanAgain }}
        testID={`${ROUTE}.refused.${reason}`}
      />
    );
  } else if (phase.kind === 'queued') {
    panel = (
      <Panel
        title={t('scanner.queued.title')}
        body={t('scanner.queued.body')}
        primary={{ label: t('scanner.scanAgain'), onPress: scanAgain }}
        secondary={{ label: t('scanner.done'), onPress: close }}
        testID={`${ROUTE}.queued`}
      />
    );
  } else {
    const reading = phase.kind !== 'idle';
    panel = (
      <View aria-live="polite">
        <Text color="onPhoto.primary" testID={reading ? `${ROUTE}.reading` : `${ROUTE}.hint`}>
          {reading ? t('scanner.reading') : t('scanner.hint')}
        </Text>
        {waiting > 0 ? (
          <Text variant="callout" color="onPhoto.primary" numeric testID={`${ROUTE}.waiting`}>
            {t('scanner.waiting', { count: waiting })}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <ThemeScope name={scope}>
      <View style={styles.stage} aria-label={t('scanner.label')} testID={`${ROUTE}.root`}>
        {showCamera ? (
          <ScannerCamera
            key={cameraKey}
            torch={torch && focused}
            onScanned={reads ? (data) => void onScanned(data) : undefined}
            onMountError={() => setCameraFailed(true)}
            testID={`${ROUTE}.camera`}
          />
        ) : null}
        <PhotoTopScrim style={styles.topScrim} />
        <PhotoStageScrim />
        <View style={[styles.bar, { paddingTop: insets.top + space[8], paddingHorizontal: gutter }]}>
          <IconButton
            icon="x"
            variant="onPhoto"
            label={t('scanner.close')}
            onPress={close}
            testID={`${ROUTE}.close`}
          />
          <IconButton
            icon="flashlight"
            variant="onPhoto"
            selected={torch && showCamera}
            disabled={!showCamera}
            label={torch && showCamera ? t('scanner.torchOff') : t('scanner.torchOn')}
            onPress={() => setTorch((on) => !on)}
            testID={`${ROUTE}.torch`}
          />
        </View>
        {online && qaState !== 'offline' ? null : (
          <OfflineBanner label={t('scanner.offline')} testID={`${ROUTE}.offline`} />
        )}
        <View style={styles.centre} onLayout={(event) => setCentreHeight(event.nativeEvent.layout.height)}>
          <ScanFrame side={frameSide} testID={`${ROUTE}.frame`} />
        </View>
        <View style={[styles.bottom, { paddingBottom: insets.bottom + gutter, paddingHorizontal: gutter }]}>
          {panel}
        </View>
        <LocationSheet
          visible={phase.kind === 'location'}
          onAllow={() => void onAllowLocation()}
          onSkip={() => void onSkipLocation()}
          onDismiss={onDismissLocation}
          testID={`${ROUTE}.location`}
        />
      </View>
    </ThemeScope>
  );
}

/**
 * DEX-02 Scanner (10 §16.2, contract §8): full screen, the camera behind a corner frame, the torch, a haptic on read. It reads
 * only our own stickers (`code.ts`); a scan goes out at once or waits in the outbox; a refusal is a calm panel with the next step.
 * The camera runs only while the screen is focused. Web: "Spotten geht nur in der App" (ADR-508).
 */
export function ScannerScreen() {
  return scannerAvailable() ? <NativeScanner /> : <OnlyInTheApp />;
}
