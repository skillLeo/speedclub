import '../qaStickers';

import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { ApiError, newIdempotencyKey } from '@/api/client';
import { useMe } from '@/api/queries/auth';
import {
  fetchStickerDesign,
  saveStickerDesign,
  settleDesign,
  stickerDesignKey,
  useMyStickers,
  useStickerDesign,
  useStickerPreview,
  useStickerTemplates,
  useValidateStickerDesign,
  type StickerDesign,
  type StickerOptions,
  type StickerTemplateKey,
  type StickerTemplates,
} from '@/api/queries/stickers';
import { useHideTabBar } from '@/features/shell/tabBarLayout';
import { useViewAsReadOnly } from '@/features/viewAs/useViewAs';
import { formatNumber, keepNameTogether } from '@/lib/format';
import { haptics } from '@/lib/haptics';
import { qa, useQaState } from '@/lib/qa';
import { useFormat } from '@/lib/useFormat';
import { useOnline } from '@/state/online';
import { useSessionStore } from '@/state/session';
import { createStyles, fontScaleCap, size, space, ThemeScope, useBreakpoint } from '@/theme';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { DiscardGuardDialog } from '@/ui/DiscardGuardDialog';
import { ErrorState } from '@/ui/ErrorState';
import { Header } from '@/ui/Header';
import { Icon } from '@/ui/icons/Icon';
import { OfflineBanner } from '@/ui/OfflineBanner';
import { Screen } from '@/ui/Screen';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Skeleton, SkeletonBlock, SkeletonText, SkeletonSurfaceContext } from '@/ui/Skeleton';
import { StickyCTABar } from '@/ui/StickyCTABar';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { useMotionPreference } from '@/ui/motion';
import { useScreenFocused } from '@/ui/SkeletonFocus';

import { QrNotice, QrSignInState, QrState } from '../components/parts';
import { StickerDownloadSheet } from '../components/StickerDownloadSheet';
import { AutosaveQueue, type AutosaveEvent, type AutosaveStatus } from '../designer/autosave';
import { DesignerControls, TemplateRail } from '../designer/DesignerControls';
import { DesignerDock } from '../designer/DesignerDock';
import {
  applyRules,
  customLineIssue,
  editorReducer,
  effectiveText,
  expandedPreviewFit,
  initialHistory,
  mayOrder,
  mayRunScanTest,
  payloadOptions,
  qaDesignerState,
  sameState,
  scanGate,
  sizeMm,
  stateOf,
  type DesignState,
  type ScanGate,
} from '../designer/model';
import { defaultMockup, type MockupKey } from '../designer/mockups';
import { PreviewStage, type PreviewMode } from '../designer/PreviewStage';
import { deviceScanTest } from '../designer/scanTest';
import { useLeaveFlush } from '../designer/useLeaveFlush';

const ROUTE = 'STK-05';
/** The preview follows the editor after this pause, so a run of taps renders once (the server allows 120 a minute). */
const PREVIEW_DEBOUNCE_MS = 250;
/** From this width the preview and the controls stand side by side. */
const SPLIT_MIN_WIDTH = 900;
const SIDE_COLUMN = 400;
/** The preview stage is the black media stage in every theme (09 §4.6: photos and prints sit on a dark stage), so its words and chips take Carbon. */
const STAGE_THEME = 'carbon' as const;
const STAGE_DATASET = { themeScope: STAGE_THEME };
/** The default design (Classic M, 156 × 65 mm) for the loading state's sticker. */
const DEFAULT_RATIO = 156 / 65;
/** DQ-P5-205: a portrait sticker lies down counter-clockwise in the expanded dock, so its top reads on the left. */
const QUARTER_TURN = -90;

const useStyles = createStyles((t) => ({
  area: { flex: 1, overflow: 'hidden' },
  fill: { flex: 1 },
  fallbackBody: { flex: 1, paddingHorizontal: t.space[20] },
  modes: { gap: t.space[8], paddingBottom: t.space[8], paddingTop: t.space[4] },
  // Clipped: a drawing can never paint over the controls column or the dock (DQ-M54-01).
  stage: { backgroundColor: t.color.media.ground, overflow: 'hidden' },
  stageCentre: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: t.space[24] },
  warnings: { paddingHorizontal: t.space[16], paddingVertical: t.space[8] },
  gate: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[8], paddingTop: t.space[12] },
  gateText: { flex: 1 },
  recovery: { alignItems: 'center', flexDirection: 'row', gap: t.space[8] },
  split: { flex: 1, flexDirection: 'row' },
  splitStage: { flex: 1 },
  side: {
    borderLeftColor: t.color.border.hairline,
    borderLeftWidth: t.size.border.control,
    width: SIDE_COLUMN,
  },
  sideScroll: { padding: t.space[24] },
  titleBlock: { flex: 1, minWidth: 0 },
  skeletonDock: {
    backgroundColor: t.color.bg.raised,
    borderTopLeftRadius: t.radius.xl,
    borderTopRightRadius: t.radius.xl,
    gap: t.space[12],
    padding: t.space[16],
    // DQ-M54R2-12: the loaded dock's grabber target sits 8 lower; the skeleton starts at the same line.
    paddingTop: t.space[24],
  },
  skeletonChips: { flexDirection: 'row', gap: t.space[8] },
  skeletonStage: {
    alignItems: 'center',
    backgroundColor: t.color.media.ground,
    flex: 1,
    justifyContent: 'center',
    padding: t.space[24],
  },
  skeletonBar: { paddingVertical: t.space[12] },
  grabber: {
    alignSelf: 'center',
    backgroundColor: t.color.border.strong,
    borderRadius: t.radius.xs,
    height: t.size.grabber.height,
    marginBottom: t.space[8],
    width: t.size.grabber.width,
  },
}));

/**
 * The editor's header (DQ-M54-02): back, "Sticker gestalten" and the car (with the autosave state) on up to two lines each, capped at
 * the pill scale (1.3) like the native compact header, and undo · redo.
 */
function DesignerHeader({
  caption,
  captionPending = false,
  onBack,
  undo,
  redo,
}: {
  caption: string | null;
  captionPending?: boolean;
  onBack: () => void;
  undo: { onPress: () => void; disabled: boolean };
  redo: { onPress: () => void; disabled: boolean };
}) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  return (
    <Header
      variant="compact"
      onBack={onBack}
      titleContent={
        <View style={styles.titleBlock}>
          <Text
            variant="headline"
            numberOfLines={2}
            fontScaleCap={fontScaleCap.pill}
            role="heading"
            aria-level={1}
            testID={`${ROUTE}.title`}
          >
            {t('designer.title')}
          </Text>
          {captionPending ? (
            <SkeletonText variant="caption" width="60%" testID={`${ROUTE}.captionSkeleton`} />
          ) : caption ? (
            <Text
              variant="captionChrome"
              color="text.secondary"
              numberOfLines={2}
              aria-live="polite"
              testID={`${ROUTE}.saveStatus`}
            >
              {caption}
            </Text>
          ) : null}
        </View>
      }
      actions={[
        {
          icon: 'arrow-u-up-left',
          label: t('designer.undo'),
          onPress: undo.onPress,
          disabled: undo.disabled,
          testID: `${ROUTE}.undo`,
        },
        {
          icon: 'arrow-u-up-right',
          label: t('designer.redo'),
          onPress: redo.onPress,
          disabled: redo.disabled,
          testID: `${ROUTE}.redo`,
        },
      ]}
      testID={`${ROUTE}.header`}
    />
  );
}

const NOOP = () => undefined;

function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/** "Gespeichert", "Speichert …", "Offline – …": the autosave in words, beside the title. */
function statusKey(status: AutosaveStatus, everSaved: boolean): string {
  if (status === 'saved') return everSaved ? 'designer.status.saved' : 'designer.status.draft';
  return `designer.status.${status}`;
}

type EditorProps = {
  vehicleId: string;
  /** `?mode=car|ruler` opens that preview (a link from the order page, the visual matrix). */
  initialMode: PreviewMode;
  /** `?scan=1`: STK-06's "Scan-Test starten" opens the designer and runs the test once (DQ-M54-15). */
  autoScan: boolean;
  vehicleTitle: string | null;
  initial: StickerDesign;
  templates: StickerTemplates | null;
  username: string | null;
  readOnly: boolean;
  suspended: boolean;
};

/**
 * The loading state in the editor's geometry (DQ-M54-04): the real header (car line pending, undo · redo off), the mode switch, the
 * black stage with the default sticker's proportion, the compact dock with its chip row and Scan-Test line on the raised tone
 * (ADR-517), and the action bar.
 */
function DesignerSkeleton({ onBack }: { onBack: () => void }) {
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  return (
    <>
      <DesignerHeader
        caption={null}
        captionPending
        onBack={onBack}
        undo={{ onPress: NOOP, disabled: true }}
        redo={{ onPress: NOOP, disabled: true }}
      />
      <Skeleton testID={`${ROUTE}.skeleton`} style={styles.fill}>
        <View style={[styles.modes, { paddingHorizontal: gutter }]}>
          <SkeletonBlock height={size.segmented} corner="sm" />
        </View>
        {/* The black stage in every theme: its block takes Carbon's skeleton tone, not a light slab (as the loaded stage). */}
        <View style={styles.skeletonStage} dataSet={STAGE_DATASET}>
          <ThemeScope name={STAGE_THEME}>
            <SkeletonBlock width="100%" aspectRatio={DEFAULT_RATIO} corner="sm" />
          </ThemeScope>
        </View>
        <SkeletonSurfaceContext value="raised">
          <View style={[styles.skeletonDock, { paddingHorizontal: gutter }]}>
            <View style={styles.grabber} />
            <View style={styles.skeletonChips}>
              {Array.from({ length: 4 }, (_, index) => (
                <SkeletonBlock key={index} width="20%" height={size.chip} corner="full" />
              ))}
            </View>
            <SkeletonText variant="callout" width="80%" />
          </View>
        </SkeletonSurfaceContext>
        <View style={[styles.skeletonBar, { paddingHorizontal: gutter }]}>
          <SkeletonBlock height={size.button.l} corner="sm" />
        </View>
      </Skeleton>
    </>
  );
}

function Editor({
  vehicleId,
  initialMode,
  autoScan,
  vehicleTitle,
  initial,
  templates,
  username,
  readOnly,
  suspended,
}: EditorProps) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const router = useRouter();
  const client = useQueryClient();
  const format = useFormat();
  const online = useOnline();
  const focused = useScreenFocused();
  const motion = useMotionPreference();
  const { gutter, width } = useBreakpoint();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const split = (measuredWidth || width) >= SPLIT_MIN_WIDTH;

  // QA capture (DQ-M54-07, never in production): another template, the QR off or a custom line, shown and never saved.
  const qaPreview = qa.designer !== undefined && qa.designer !== 'expanded';
  const [history, dispatch] = useReducer(
    editorReducer,
    qaDesignerState(stateOf(initial), qa.designer, t('designer.qaLine')),
    initialHistory,
  );
  const present = history.present;
  const [server, setServer] = useState<StickerDesign>(initial);
  const [status, setStatus] = useState<AutosaveStatus>('saved');
  const [lineError, setLineError] = useState<string | null>(null);
  const [ruleNote, setRuleNote] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  /** "Später" closed the conflict dialog; the status line offers "Konflikt lösen" (review SF-3). */
  const [conflictDeferred, setConflictDeferred] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<PreviewMode>(initialMode);
  const [mockup, setMockup] = useState<MockupKey>(defaultMockup(initial.options.colourway));
  const [sheet, setSheet] = useState(false);
  const validate = useValidateStickerDesign(vehicleId);
  const scanKey = useRef<string | null>(null);
  // While the Scan-Test runs, the design under test stays as it is (review MF-1): no edits, no undo or redo.
  const disabled = readOnly || suspended || status === 'forbidden' || testing;

  const onEvent = useCallback((event: AutosaveEvent) => {
    if (event.type === 'status') {
      setStatus(event.status);
      if (event.status === 'conflict') {
        setConflict(true);
        setConflictDeferred(false);
      }
      return;
    }
    if (event.type === 'saved') {
      // The cache was settled by the save itself (it also happens after the screen is gone, review MF-2).
      setServer(event.design);
      return;
    }
    const field = event.fieldErrors['options.custom_line'] ?? event.fieldErrors.custom_line;
    if (field?.[0]) setLineError(field[0]);
    else {
      const first = Object.values(event.fieldErrors)[0]?.[0] ?? event.message;
      setRuleNote(first);
    }
  }, []);

  // One queue per editor; it reports to the handler of the latest render. Each save settles the cache itself.
  const [autosave] = useState(
    () =>
      new AutosaveQueue(initial, async ({ baseVersion, baseRevision, state, keepalive }) => {
        const saved = await saveStickerDesign(
          vehicleId,
          { baseVersion, baseRevision, template: state.template, options: state.options },
          keepalive,
        );
        settleDesign(client, vehicleId, saved);
        return saved;
      }),
  );
  useEffect(() => autosave.listen(onEvent), [autosave, onEvent]);
  // When the screen goes, what waits is still sent, a save on its way included (an autosave never needs a save button).
  useEffect(
    () => () => {
      void autosave.close();
    },
    [autosave],
  );
  useLeaveFlush(autosave);
  // Back on the screen: a save that failed while it was away tries again.
  useFocusEffect(
    useCallback(() => {
      autosave.resume();
    }, [autosave]),
  );

  // Review MF-3: the editor follows the server while nothing of the member waits (a restore in STK-07, another device, a refetch on
  // focus). It listens to the design's cache entry; a copy with the editor's own content only moves the base, other content replaces
  // the editor (no undo across it).
  const live = useRef({ server, present, testing, conflict });
  useEffect(() => {
    live.current = { server, present, testing, conflict };
  });
  useEffect(() => {
    const key = JSON.stringify(stickerDesignKey(vehicleId));
    return client.getQueryCache().subscribe((event) => {
      if (
        event.type !== 'updated' ||
        event.action.type !== 'success' ||
        JSON.stringify(event.query.queryKey) !== key
      )
        return;
      const latest = event.query.state.data as StickerDesign | undefined;
      const now = live.current;
      if (!latest || now.testing || now.conflict || autosave.unsaved || autosave.status !== 'saved') return;
      if (latest.version < now.server.version) return;
      // Review SF-5: an answer older than what this device saved (same version, lower revision) is history, never news.
      const known = Math.max(now.server.revision, autosave.revision);
      if (latest.version === now.server.version && latest.revision < known) return;
      if (
        latest.version === now.server.version &&
        latest.revision === now.server.revision &&
        latest.updated_at === now.server.updated_at
      ) {
        return;
      }
      if (!sameState(now.present, stateOf(now.server)) && !sameState(now.present, stateOf(latest))) {
        // Review SF-6: the editor holds something the server never got (a custom line the app refuses, an edit not sent yet), and
        // the server moved on: never replace it silently. The member chooses in the conflict dialog.
        setConflict(true);
        setConflictDeferred(false);
        return;
      }
      autosave.rebase(latest);
      setServer(latest);
      if (!sameState(stateOf(latest), now.present)) dispatch({ type: 'reset', state: stateOf(latest) });
    });
  }, [client, vehicleId, autosave]);

  const localIssue = customLineIssue(present.options.custom_line);
  useEffect(() => {
    if (disabled || localIssue || qaPreview) return;
    autosave.change(present);
  }, [autosave, present, disabled, localIssue, qaPreview]);

  useEffect(() => {
    if (online) autosave.resume();
  }, [autosave, online]);

  const edit = useCallback(
    (patch: Partial<StickerOptions>, coalesce?: string) => {
      const ruled = applyRules({ ...present.options, ...patch }, templates);
      if ('custom_line' in patch) setLineError(null);
      setRuleNote(
        ruled.changed.includes('mirrored')
          ? t('designer.rules.mirroredOff')
          : ruled.changed.includes('material')
            ? t('designer.rules.materialTransparent')
            : null,
      );
      if ('colourway' in patch && patch.colourway) setMockup(defaultMockup(patch.colourway));
      dispatch({ type: 'edit', state: { template: present.template, options: ruled.options }, coalesce });
    },
    [present, templates, t],
  );

  const setTemplate = (template: StickerTemplateKey) => {
    if (template === present.template) return;
    haptics.selection();
    dispatch({ type: 'edit', state: { template, options: present.options } });
  };

  // -- Preview
  const previewState = useDebounced<DesignState>(
    useMemo(() => ({ template: present.template, options: payloadOptions(present.options) }), [present]),
    PREVIEW_DEBOUNCE_MS,
  );
  const preview = useStickerPreview(vehicleId, localIssue ? null : previewState);
  const mm = sizeMm(present, templates) ?? {
    width: server.size_mm.width,
    height: server.size_mm.height,
    qr: server.qr_mm,
  };
  const effective = effectiveText(present, templates);
  const number = (value: number) => formatNumber(value, format.locale, { maxFractionDigits: 1 });
  const templateName =
    templates?.templates.find((entry) => entry.key === present.template)?.name ??
    t(`designer.template.names.${present.template}`);
  const colourwayName =
    templates?.colourways.find((entry) => entry.key === present.options.colourway)?.name ??
    t(`designer.print.colourways.${present.options.colourway}.name`);
  const lines = [
    effective.username && username ? `@${username}` : null,
    effective.car_name ? (vehicleTitle ?? t('designer.content.carName')) : null,
    effective.custom_line ? (present.options.custom_line ?? '').trim() : null,
  ].filter(Boolean);
  const previewLabel = t('designer.preview.label', {
    template: templateName,
    width: number(mm.width),
    height: number(mm.height),
    colourway: colourwayName,
    qr: present.options.qr ? t('designer.preview.withQr') : t('designer.preview.withoutQr'),
    lines: lines.length > 0 ? lines.join(', ') : t('designer.preview.noLines'),
    mirrored: present.options.mirrored ? t('designer.preview.mirrored') : '',
  }).trim();

  // -- Scan-Test gate
  // A QA preview (never in production) shows its state as if it were the saved one: nothing is sent, so nothing "waits".
  const editorDiffers = !qaPreview && !sameState(present, stateOf(server));
  const unsaved = editorDiffers || status === 'pending' || status === 'saving';
  const gate: ScanGate = scanGate({ design: server, unsaved });
  const orderable = mayOrder(gate);

  const reloadNewest = useCallback(async () => {
    const newest = await fetchStickerDesign(vehicleId);
    client.setQueryData(stickerDesignKey(vehicleId), newest);
    return newest;
  }, [client, vehicleId]);

  const resolveConflict = async (keep: boolean) => {
    setResolving(true);
    try {
      const newest = await reloadNewest();
      // An own line the app refuses is kept in the editor and sent once it is fixed, never sent as it is.
      autosave.resolveConflict(newest, keep && !localIssue, present);
      setServer(newest);
      if (!keep) dispatch({ type: 'reset', state: stateOf(newest) });
      setConflict(false);
      setConflictDeferred(false);
    } catch {
      // Offline or the server is away: the dialog stays, and "Später" leaves it with the conflict kept (review SF-3).
      toast(t('designer.conflict.failed'), { testID: `${ROUTE}.conflictToast` });
    } finally {
      setResolving(false);
    }
  };

  const runScanTest = async () => {
    setScanMessage(null);
    setTesting(true);
    let savesBefore = autosave.saveCount;
    try {
      await autosave.ensureSaved(present);
      if (autosave.unsaved || autosave.status !== 'saved') return;
      savesBefore = autosave.saveCount;
      const clientResult = await deviceScanTest(preview.data?.svg ?? null, server.code?.display_code ?? null);
      scanKey.current ??= newIdempotencyKey();
      const design = await validate.mutateAsync({
        version: autosave.version,
        clientScanTest: clientResult,
        idempotencyKey: scanKey.current,
      });
      scanKey.current = null;
      autosave.rebase(design);
      setServer(design);
      if (design.state === 'validated') haptics.success();
    } catch (error) {
      scanKey.current = null;
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === 'edit_conflict' &&
        autosave.saveCount !== savesBefore
      ) {
        // This device saved during the render (review MF-1): the member's own change, not another device's. Test again.
        setScanMessage(t('designer.scan.changedDuringTest'));
        void reloadNewest()
          .then((newest) => {
            autosave.rebase(newest);
            setServer(newest);
          })
          .catch(() => undefined);
      } else if (error instanceof ApiError && error.status === 409 && error.code === 'edit_conflict') {
        // The draft changed while the server rendered it (another device): the same choice as an autosave conflict.
        setConflict(true);
        setConflictDeferred(false);
      } else if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === 'sticker_no_active_code'
      ) {
        setScanMessage(t('designer.scan.noActiveCode'));
        void reloadNewest()
          .then(setServer)
          .catch(() => undefined);
      } else if (error instanceof ApiError && error.status === 422) {
        haptics.warning();
        setScanMessage(t('designer.scan.failedBody'));
        void reloadNewest()
          .then(setServer)
          .catch(() => undefined);
      } else if (error instanceof ApiError && error.status === 429) {
        setScanMessage(t('designer.scan.rateLimited'));
      } else {
        haptics.error();
        setScanMessage(
          error instanceof ApiError && error.kind === 'network'
            ? t('designer.scan.offline')
            : t('designer.scan.error'),
        );
      }
    } finally {
      setTesting(false);
    }
  };

  const deferConflict = () => {
    setConflict(false);
    setConflictDeferred(true);
  };

  // STK-06 sent the member here to test: run it once, as soon as the design can be tested.
  const autoScanned = useRef(false);
  useEffect(() => {
    if (!autoScan || autoScanned.current || testing || !online || disabled) return;
    if (!mayRunScanTest(gate === 'needsSave' && !editorDiffers ? 'needsTest' : gate)) return;
    // After this render settles (a test started inside the effect would set state during it).
    const timer = setTimeout(() => {
      if (autoScanned.current) return;
      autoScanned.current = true;
      void runScanTest();
    }, 0);
    return () => clearTimeout(timer);
  });

  // -- Leaving: what cannot be saved right now is guarded (offline, refused, conflict); anything else is flushed.
  const stuck =
    editorDiffers &&
    (status === 'offline' ||
      status === 'error' ||
      status === 'conflict' ||
      status === 'invalid' ||
      localIssue !== null);

  // -- Stage geometry (phones: stage above a dock; from 900: side by side)
  // DQ-M54-01: the room is measured, never derived from the window (the rail, the sidebar and the controls column take their share).
  const [area, setArea] = useState({ width: 0, height: 0 });
  const areaHeight = area.height;
  const [modesHeight, setModesHeight] = useState(0);
  const [dockHeight, setDockHeight] = useState(0);
  const progress = useSharedValue(0);
  const stageHeight = Math.max(0, areaHeight - modesHeight - (split ? 0 : dockHeight));
  const stageWidth = Math.max(0, split ? area.width - SIDE_COLUMN - size.border.control : area.width);
  const dockRoom = Math.max(0, areaHeight - modesHeight);
  const expandedCover = Math.max(0, Math.round(dockRoom * 0.72) - dockHeight);
  // DQ-M54R2-01: the stage stays full width at every detent; only its drawing moves up into the part the dock leaves and shrinks just
  // enough to fit it (the flat preview draws the sticker at min(width − 48, (height − 48) × ratio)). DQ-P5-205: a portrait sticker
  // in the flat preview lies down as the dock rises (a quarter turn with the dock's progress) instead of shrinking to a sliver; the
  // other previews keep a minimum width.
  const fit = expandedPreviewFit({
    stageWidth,
    stageHeight,
    cover: expandedCover,
    ratio: mm.height > 0 ? mm.width / mm.height : 1,
    inset: space[24],
    rotatable: mode === 'flat',
  });
  const shrink = fit.scale;
  const turn = fit.rotate ? QUARTER_TURN : 0;
  const stageStyle = useAnimatedStyle(() => {
    const scale = 1 - (1 - shrink) * progress.get();
    return { transform: [{ translateY: fit.shift * progress.get() }, { scale }, { rotate: `${turn * progress.get()}deg` }] };
  });

  const previewWarnings = (preview.data?.warnings ?? []).filter((warning) => warning.endsWith('_too_long'));
  const svg = preview.data?.svg ?? null;

  let stage: ReactNode;
  if (svg && stageHeight > 0 && stageWidth > 0) {
    stage = (
      <PreviewStage
        mode={mode}
        svg={svg}
        widthMm={preview.data?.size_mm.width ?? mm.width}
        heightMm={preview.data?.size_mm.height ?? mm.height}
        material={present.options.material}
        label={previewLabel}
        width={stageWidth}
        height={stageHeight}
        mockup={mockup}
        onMockupChange={(key) => {
          haptics.selection();
          setMockup(key);
        }}
        tiltActive={focused && !motion.reduced}
        testID={`${ROUTE}.preview`}
      />
    );
  } else if (localIssue) {
    stage = (
      <View style={styles.stageCentre}>
        <Text variant="callout" color="onPhoto.secondary" testID={`${ROUTE}.preview.paused`}>
          {t('designer.preview.paused')}
        </Text>
      </View>
    );
  } else if (preview.isError || preview.fetchStatus === 'paused') {
    stage = (
      <View style={styles.stageCentre}>
        <ErrorState
          title={t('designer.preview.errorTitle')}
          onRetry={() => void preview.refetch()}
          retrying={preview.isFetching}
          testID={`${ROUTE}.preview.error`}
        />
      </View>
    );
  } else {
    stage = (
      <Skeleton testID={`${ROUTE}.preview.skeleton`} style={styles.stageCentre}>
        <SkeletonBlock width="80%" aspectRatio={mm.width / mm.height} corner="sm" />
      </Skeleton>
    );
  }

  const gateLine = (() => {
    if (scanMessage) return { icon: 'warning' as const, color: 'accent.fg' as const, text: scanMessage };
    if (!online && !mayOrder(gate))
      return {
        icon: 'wifi-slash' as const,
        color: 'text.secondary' as const,
        text: t('designer.scan.offline'),
      };
    switch (gate) {
      case 'passed':
        return {
          icon: 'check-circle' as const,
          color: 'state.success' as const,
          text: t('designer.scan.passed'),
        };
      case 'notApplicable':
        return {
          icon: 'info' as const,
          color: 'text.secondary' as const,
          text: t('designer.scan.notApplicable'),
        };
      case 'failed':
        return { icon: 'warning' as const, color: 'accent.fg' as const, text: t('designer.scan.failed') };
      case 'noActiveCode':
        return {
          icon: 'warning' as const,
          color: 'accent.fg' as const,
          text: t('designer.scan.noActiveCode'),
        };
      case 'needsSave':
        // The untouched default (version 0) is saved by the test itself: nothing waits for the member.
        return editorDiffers || status !== 'saved'
          ? { icon: 'clock' as const, color: 'text.secondary' as const, text: t('designer.scan.needsSave') }
          : {
              icon: 'qr-code' as const,
              color: 'text.secondary' as const,
              text: t('designer.scan.needsTest'),
            };
      default:
        return {
          icon: 'qr-code' as const,
          color: 'text.secondary' as const,
          text: t('designer.scan.needsTest'),
        };
    }
  })();

  // Review SF-1/SF-3: a save that failed or waits for the connection can be retried here, a deferred conflict reopened.
  const recovery = conflictDeferred
    ? {
        label: t('designer.conflict.resolve'),
        onPress: () => setConflict(true),
        testID: `${ROUTE}.resolveConflict`,
      }
    : (status === 'error' || status === 'offline') && autosave.unsaved
      ? { label: t('common.retry'), onPress: () => autosave.resume(), testID: `${ROUTE}.retrySave` }
      : null;

  const gateView = (
    <>
      <View style={styles.gate} role="status" testID={`${ROUTE}.scanState`}>
        <Icon name={gateLine.icon} size={20} color={gateLine.color} />
        <Text
          variant="callout"
          color={gate === 'passed' ? 'text.primary' : 'text.secondary'}
          style={styles.gateText}
        >
          {gateLine.text}
        </Text>
      </View>
      {recovery ? (
        <View style={styles.recovery}>
          <Text variant="callout" color="text.secondary" style={styles.gateText}>
            {conflictDeferred ? t('designer.status.conflict') : t(statusKey(status, true))}
          </Text>
          <Button
            label={recovery.label}
            variant="tertiary"
            size="s"
            onPress={recovery.onPress}
            testID={recovery.testID}
          />
        </View>
      ) : null}
    </>
  );

  const controls = (
    <DesignerControls
      state={present}
      templates={templates}
      customLineError={lineError}
      customLineIssue={localIssue}
      disabled={disabled}
      ruleNote={ruleNote}
      onOptions={edit}
      onCustomLineBlur={() => dispatch({ type: 'commit' })}
      onOpenHistory={() => router.push({ pathname: '/stickers/[vehicleId]/history', params: { vehicleId } })}
      onOpenPlacement={() =>
        router.push({ pathname: '/stickers/[vehicleId]/placement', params: { vehicleId } })
      }
      testID={ROUTE}
    />
  );

  const rail = (
    <>
      <TemplateRail
        value={present.template}
        templates={templates}
        onChange={setTemplate}
        disabled={disabled}
        wrap={split}
        testID={ROUTE}
      />
      {gateView}
    </>
  );

  const ready = server.version > 0 && Boolean(server.id);
  const cta = orderable
    ? {
        label: t('designer.order'),
        onPress: () => router.push({ pathname: '/stickers/[vehicleId]/order', params: { vehicleId } }),
        disabled: false,
        loading: false,
      }
    : {
        label: t('designer.scan.run'),
        onPress: () => void runScanTest(),
        // The test decodes on the server (ADR-508): offline it cannot run (DQ-M54-18).
        disabled:
          disabled ||
          !online ||
          !mayRunScanTest(gate === 'needsSave' && !editorDiffers ? 'needsTest' : gate) ||
          localIssue !== null,
        loading: testing,
      };

  const everSaved = server.version > 0;
  const statusText = t(statusKey(status, everSaved));
  const pristine = !everSaved && status === 'saved' && !editorDiffers;

  return (
    <>
      <DesignerHeader
        // An untouched default has nothing to report: the car alone.
        caption={
          pristine && vehicleTitle
            ? keepNameTogether(vehicleTitle)
            : vehicleTitle
              ? `${keepNameTogether(vehicleTitle)} · ${statusText}`
              : statusText
        }
        onBack={() =>
          router.canGoBack()
            ? router.back()
            : router.replace({ pathname: '/stickers/[vehicleId]', params: { vehicleId } })
        }
        undo={{ onPress: () => dispatch({ type: 'undo' }), disabled: disabled || history.past.length === 0 }}
        redo={{
          onPress: () => dispatch({ type: 'redo' }),
          disabled: disabled || history.future.length === 0,
        }}
      />
      {online ? null : <OfflineBanner label={t('designer.offlineBanner')} testID={`${ROUTE}.offline`} />}
      {suspended ? (
        <QrNotice
          message={t('designer.suspended')}
          style={{ marginHorizontal: gutter, marginBottom: space[8] }}
          testID={`${ROUTE}.restricted`}
        />
      ) : null}
      <View
        style={styles.area}
        onLayout={(event: LayoutChangeEvent) => {
          const { width: areaWidth, height } = event.nativeEvent.layout;
          setArea({ width: areaWidth, height });
          setMeasuredWidth(areaWidth);
        }}
        testID={`${ROUTE}.area`}
      >
        {split ? (
          <View style={styles.split}>
            <View style={styles.splitStage}>
              <View
                style={[styles.modes, { paddingHorizontal: gutter }]}
                onLayout={(event: LayoutChangeEvent) => setModesHeight(event.nativeEvent.layout.height)}
              >
                <ModeSwitch mode={mode} onChange={setMode} />
              </View>
              <View
                style={[styles.stage, { height: stageHeight }]}
                dataSet={STAGE_DATASET}
                testID={`${ROUTE}.stage`}
              >
                <ThemeScope name={STAGE_THEME}>{stage}</ThemeScope>
              </View>
            </View>
            <View style={styles.side}>
              <Animated.ScrollView
                contentContainerStyle={styles.sideScroll}
                keyboardShouldPersistTaps="handled"
                testID={`${ROUTE}.side`}
              >
                {rail}
                {previewWarnings.length > 0 ? <PreviewWarnings warnings={previewWarnings} /> : null}
                {controls}
              </Animated.ScrollView>
            </View>
          </View>
        ) : (
          <>
            <View
              style={[styles.modes, { paddingHorizontal: gutter }]}
              onLayout={(event: LayoutChangeEvent) => setModesHeight(event.nativeEvent.layout.height)}
            >
              <ModeSwitch mode={mode} onChange={setMode} />
            </View>
            <View
              style={[styles.stage, { height: stageHeight }]}
              dataSet={STAGE_DATASET}
              testID={`${ROUTE}.stage`}
            >
              <Animated.View style={[styles.fill, stageStyle]}>
                <ThemeScope name={STAGE_THEME}>{stage}</ThemeScope>
              </Animated.View>
            </View>
            <DesignerDock
              // QA capture: the option states open with every option in view.
              initialDetent={
                qa.designer === 'expanded' || qa.designer === 'qroff' || qa.designer === 'line'
                  ? 'expanded'
                  : 'compact'
              }
              room={dockRoom}
              progress={progress}
              onCompactHeight={setDockHeight}
              gutter={gutter}
              header={rail}
              testID={ROUTE}
            >
              {previewWarnings.length > 0 ? <PreviewWarnings warnings={previewWarnings} /> : null}
              {controls}
            </DesignerDock>
          </>
        )}
      </View>
      <StickyCTABar
        label={cta.label}
        onPress={cta.onPress}
        disabled={cta.disabled}
        loading={cta.loading}
        secondary={
          orderable && ready && server.urls.print_pdf
            ? { label: t('hub.download'), onPress: () => setSheet(true), testID: `${ROUTE}.download` }
            : undefined
        }
        testID={`${ROUTE}.cta`}
      />
      <Dialog
        visible={conflict}
        title={t('designer.conflict.title')}
        body={t('designer.conflict.body')}
        onClose={deferConflict}
        actions={[
          {
            label: t('designer.conflict.load'),
            onPress: () => void resolveConflict(false),
            variant: 'primary',
            loading: resolving,
            testID: `${ROUTE}.conflict.load`,
          },
          {
            label: t('designer.conflict.keep'),
            onPress: () => void resolveConflict(true),
            variant: 'secondary',
            disabled: resolving,
            testID: `${ROUTE}.conflict.keep`,
          },
          // Review SF-3: a way out that keeps the conflict (the status line offers "Konflikt lösen"), also when the reload failed offline.
          {
            label: t('designer.conflict.later'),
            onPress: deferConflict,
            variant: 'tertiary',
            disabled: resolving,
            testID: `${ROUTE}.conflict.later`,
          },
        ]}
        testID={`${ROUTE}.conflict`}
      />
      <DiscardGuardDialog
        dirty={stuck}
        title={t('designer.discard.title')}
        body={status === 'offline' ? t('designer.discard.offline') : t('designer.discard.body')}
        testID={`${ROUTE}.discard`}
      />
      <StickerDownloadSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        target={
          server.id && server.reference
            ? { designId: server.id, reference: server.reference, version: server.version }
            : null
        }
        vehicleTitle={vehicleTitle ?? ''}
        onStale={() =>
          void reloadNewest()
            .then(setServer)
            .catch(() => undefined)
        }
        routeId={ROUTE}
      />
    </>
  );
}

/**
 * Flach · Am Auto · 1:1 (the last one's accessible name "Originalgröße"), in `label.control`: callout metrics capped at 1.3 like the
 * tab bar (DQ-M54-02, ADR-523), so the audit reads them as the type scale they are.
 */
function ModeSwitch({ mode, onChange }: { mode: PreviewMode; onChange: (mode: PreviewMode) => void }) {
  const { t } = useTranslation('qr');
  return (
    <SegmentedControl
      labelVariant="labelControl"
      role="tablist"
      label={t('designer.preview.modes')}
      options={[
        { value: 'flat' as const, label: t('designer.preview.flat') },
        { value: 'car' as const, label: t('designer.preview.car') },
        {
          value: 'ruler' as const,
          label: t('designer.preview.rulerShort'),
          accessibilityLabel: t('designer.preview.ruler'),
        },
      ]}
      value={mode}
      onChange={onChange}
      testID={`${ROUTE}.mode`}
    />
  );
}

function PreviewWarnings({ warnings }: { warnings: readonly string[] }) {
  const { t } = useTranslation('qr');
  return (
    <QrNotice
      message={warnings.map((warning) => t(`designer.preview.warnings.${warning}`)).join(' ')}
      style={{ marginTop: space[12] }}
      testID={`${ROUTE}.previewWarnings`}
    />
  );
}

/** STK-05 ★ Sticker designer (10 §2.3, ADR-504): full-screen editor with live preview, dock, undo/redo, autosave and the Scan-Test. */
export function StickerDesignerScreen() {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const router = useRouter();
  useHideTabBar();
  const {
    vehicleId: param,
    mode: modeParam,
    scan,
  } = useLocalSearchParams<{ vehicleId: string; mode?: string; scan?: string }>();
  const vehicleId = typeof param === 'string' ? param : '';
  const initialMode: PreviewMode = modeParam === 'car' || modeParam === 'ruler' ? modeParam : 'flat';
  const qaState = useQaState();
  const online = useOnline();
  const session = useSessionStore((state) => state.status);
  const me = useMe();
  const readOnly = useViewAsReadOnly();
  const design = useStickerDesign(vehicleId);
  const templates = useStickerTemplates();
  // Back on the designer (from STK-07, STK-06, another app): read the server again; the editor follows it while idle (review MF-3).
  const refetchDesign = design.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchDesign();
    }, [refetchDesign]),
  );
  const cards = useMyStickers();
  const card = cards.data?.find((entry) => entry.vehicle.id === vehicleId);
  const suspended = qaState === 'restricted' || me.data?.restrictions.suspended === true;
  const answered =
    design.error instanceof ApiError && (design.error.status === 403 || design.error.status === 404);
  // Review MF-2: the editor opens only on a design read after this screen mounted, never on the hub's placeholder or an older copy.
  const loaded =
    design.data && !design.isPlaceholderData && design.isFetchedAfterMount ? design.data : undefined;

  let body: ReactNode;
  if (session === 'guest') {
    body = <QrSignInState routeId={ROUTE} />;
  } else if (
    qaState === 'loading' ||
    session === 'loading' ||
    (!loaded &&
      (design.isPending || design.isFetching) &&
      design.fetchStatus !== 'paused' &&
      qaState === 'default')
  ) {
    return (
      <Screen edges={['left', 'right']} testID={`${ROUTE}.root`}>
        <DesignerSkeleton onBack={() => (router.canGoBack() ? router.back() : router.replace('/stickers'))} />
      </Screen>
    );
  } else if (qaState === 'empty' || (!loaded && answered)) {
    body = (
      <QrState
        routeId={ROUTE}
        name="unavailable"
        icon="qr-code"
        title={t('unavailable.title')}
        body={t('unavailable.body')}
        action={{
          label: t('unavailable.garage'),
          onPress: () => router.navigate('/garage'),
          variant: 'secondary',
          size: 'm',
        }}
      />
    );
  } else if (qaState === 'error' || !loaded) {
    const offline = !online || design.fetchStatus === 'paused';
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : t('designer.errorTitle')}
        message={offline ? t('common.offlineBody') : undefined}
        onRetry={() => {
          void design.refetch();
          void templates.refetch();
        }}
        retrying={design.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else {
    return (
      <Screen edges={['left', 'right']} testID={`${ROUTE}.root`}>
        <Editor
          key={vehicleId}
          vehicleId={vehicleId}
          initialMode={initialMode}
          autoScan={scan === '1'}
          vehicleTitle={card?.vehicle.full_title ?? null}
          initial={loaded}
          templates={templates.data ?? null}
          username={me.data?.username ?? null}
          readOnly={readOnly}
          suspended={suspended}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right']} testID={`${ROUTE}.root`}>
      <Header
        variant="compact"
        title={t('designer.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/stickers'))}
        testID={`${ROUTE}.header`}
      />
      {online ? null : <OfflineBanner label={t('designer.offlineBanner')} testID={`${ROUTE}.offline`} />}
      <View style={styles.fallbackBody}>{body}</View>
    </Screen>
  );
}
