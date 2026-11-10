import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View, type TextStyle } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { useResolveQr } from '@/api/queries/qr';
import { keepNameTogether } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, size, useBreakpoint } from '@/theme';
import { Button, ErrorState, Header, Icon, OfflineBanner, Screen, Skeleton, SkeletonBlock, SkeletonText, Text, type IconName } from '@/ui';

import { noteSignupOrigin } from '@/features/auth/signupRef';

import { normalizeQrCode } from '../code';
import { INVALID_CODE_OUTCOME, resolverOutcome, vehicleRoute, type QrStateKind, type ResolverOutcome } from '../resolve';

const ROUTE = 'QR-RESOLVE';
/** Outside the tabs: the Header pads the top, the screen the other edges. */
const EDGES: readonly Edge[] = ['bottom', 'left', 'right'];

/** DQ-172: one glyph per state, the same as WEB-06 (web/resources/views/public/state.blade.php). */
const STATE_ICON: Readonly<Record<QrStateKind, IconName>> = {
  revoked: 'prohibit',
  private: 'lock-simple',
  not_found: 'magnifying-glass',
};

/** DQ-211: at a large font the title takes several lines, and "QR-Code" held together must not leave its last word alone, as on WEB-06. */
const TITLE_WRAP = isWeb ? ({ textWrap: 'balance' } as unknown as TextStyle) : undefined;

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  // Centred in the window; at a large font it scrolls instead of clipping.
  content: { flexGrow: 1, justifyContent: 'center', paddingVertical: t.space[24] },
  // As SYS-03: a 480 column in the middle from 768, its text still on the left.
  block: { width: '100%' },
  blockCentred: { alignSelf: 'center', maxWidth: (t.layout.feedColumn * 3) / 4 },
  title: { marginTop: t.space[12] },
  body: { marginTop: t.space[8] },
  actions: { gap: t.space[12], marginTop: t.space[24] },
  actionsWide: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
  skeleton: { gap: t.space[8] },
  skeletonActions: { gap: t.space[12], marginTop: t.space[16] },
}));

function ResolveSkeleton() {
  const styles = useStyles();
  const { t } = useTranslation('qr');
  return (
    <Skeleton label={t('resolve.checking')} style={styles.skeleton} testID={`${ROUTE}.skeleton`}>
      <SkeletonBlock width={size.icon.l} height={size.icon.l} corner="xs" />
      <SkeletonText variant="titleL" width="80%" />
      <SkeletonText variant="body" width="90%" />
      <View style={styles.skeletonActions}>
        <SkeletonBlock width="100%" height={size.button.l} corner="sm" />
        <SkeletonBlock width="100%" height={size.button.l} corner="sm" />
      </View>
    </Skeleton>
  );
}

/** WEB-06 in the app: one line of what happened, a way forward, never anything about the vehicle behind the code. */
function ResolverState({ outcome }: { outcome: Extract<ResolverOutcome, { kind: 'state' }> }) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const router = useRouter();
  const { kind } = useBreakpoint();
  const wide = kind !== 'phone';
  // DQ-162: the server's copy may still write "QR-Code" with a plain hyphen, which breaks as "QR- / Code" at a large
  // font; the word joiner keeps it whole as the app's own strings do (§4).
  const title = keepNameTogether(outcome.title ?? t(`resolve.states.${outcome.state}.title`));
  const body = keepNameTogether(outcome.message ?? t(`resolve.states.${outcome.state}.body`));
  return (
    <View testID={`${ROUTE}.state.${outcome.state}`}>
      <Icon name={STATE_ICON[outcome.state]} size={24} color="text.secondary" testID={`${ROUTE}.glyph.${STATE_ICON[outcome.state]}`} />
      <Text variant="titleL" role="heading" aria-level={1} style={[styles.title, TITLE_WRAP]} testID={`${ROUTE}.title`}>
        {title}
      </Text>
      <Text color="text.secondary" style={styles.body} testID={`${ROUTE}.body`}>
        {body}
      </Text>
      <View style={[styles.actions, wide ? styles.actionsWide : null]}>
        <Button
          label={t('resolve.discover')}
          role="link"
          size="l"
          fullWidth={!wide}
          onPress={() => router.replace('/discover')}
          testID={`${ROUTE}.discover`}
        />
        <Button
          label={t('resolve.home')}
          role="link"
          variant="secondary"
          size="l"
          fullWidth={!wide}
          onPress={() => router.replace('/')}
          testID={`${ROUTE}.home`}
        />
      </View>
    </View>
  );
}

/** A forced state of the visual matrix, with the copy of the app rather than an answer. */
function qaOutcome(qaState: ReturnType<typeof useQaState>): Extract<ResolverOutcome, { kind: 'state' }> | null {
  if (qaState === 'empty') return { kind: 'state', state: 'not_found', title: null, message: null };
  if (qaState === 'restricted') return { kind: 'state', state: 'private', title: null, message: null };
  return null;
}

/**
 * c/[code]: the in-app resolver of a scanned or typed code. The code is normalised like the server's (uppercase, separators
 * dropped, O as 0, I and L as 1); an active code opens VEH-01 in place of this screen, everything else is a calm state with
 * WEB-06's words. A code that cannot exist answers without a request.
 */
export function QrResolveScreen() {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const qaState = useQaState();
  const { gutter, kind } = useBreakpoint();
  const { code: param } = useLocalSearchParams<{ code: string }>();
  const code = normalizeQrCode(param);
  const query = useResolveQr(qaState === 'default' || qaState === 'offline' ? code : null);

  const forced = qaOutcome(qaState);
  const outcome: ResolverOutcome | null =
    forced ?? (code === null ? INVALID_CODE_OUTCOME : query.data ? resolverOutcome(query.data) : null);
  const slug = outcome?.kind === 'vehicle' ? outcome.slug : null;

  // ADR-216: a sign-up after this scan, in this run of the app, counts as one from a QR sticker.
  useEffect(() => {
    if (code !== null) noteSignupOrigin(`/c/${code}`);
  }, [code]);

  useEffect(() => {
    if (slug) router.replace(vehicleRoute(slug));
  }, [router, slug]);

  let body: ReactNode;
  if (qaState === 'loading') {
    body = <ResolveSkeleton />;
  } else if (qaState === 'error' || (!outcome && (query.isError || query.fetchStatus === 'paused'))) {
    const offline = !online || query.fetchStatus === 'paused';
    const limited = query.error instanceof ApiError && query.error.kind === 'rate_limited';
    body = (
      <ErrorState
        title={offline ? t('common.offlineTitle') : limited ? t('resolve.rateLimitedTitle') : t('resolve.errorTitle')}
        message={offline ? t('resolve.offlineBody') : limited ? t('resolve.rateLimitedBody') : undefined}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        testID={`${ROUTE}.error`}
      />
    );
  } else if (outcome?.kind === 'state') {
    body = <ResolverState outcome={outcome} />;
  } else {
    // Loading, and the moment before VEH-01 replaces this screen.
    body = <ResolveSkeleton />;
  }

  return (
    <Screen edges={EDGES} testID={`${ROUTE}.root`}>
      <Header
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        backIcon={router.canGoBack() ? 'back' : 'close'}
        testID={`${ROUTE}.header`}
      />
      {online ? null : <OfflineBanner label={t('common.offlineBanner')} testID={`${ROUTE}.offline`} />}
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]} testID={`${ROUTE}.scroll`}>
        <View style={[styles.block, kind === 'phone' ? null : styles.blockCentred]}>{body}</View>
      </ScrollView>
    </Screen>
  );
}
