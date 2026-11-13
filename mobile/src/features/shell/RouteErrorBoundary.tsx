import { useNavigation, usePathname, useRouter, useSegments, type ErrorBoundaryProps } from 'expo-router';
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Edge } from 'react-native-safe-area-context';

import { reportClientError } from '@/api/clientErrors';
import { isWeb } from '@/lib/platform';
import { createStyles } from '@/theme';
import { ErrorState, Header, Screen } from '@/ui';

import { ShellOfflineBanner } from './ShellOfflineBanner';
import { useTabBarPadding } from './tabBarLayout';

const EDGES: readonly Edge[] = ['left', 'right'];
/** The route of the root stack (src/app/_layout.tsx) that presents the modal group as one modal. */
const MODAL_GROUP = '(modals)';

const useStyles = createStyles(() => ({
  body: { flex: 1, justifyContent: 'center' },
}));

/**
 * A route chunk that did not arrive (web loads routes lazily; expo's script loader says "Loading module … failed") or a request that
 * never got an answer. Only then is the connection the cause worth naming; anything else is a screen that could not render.
 */
const NETWORK_ERROR_NAMES = new Set(['ChunkLoadError', 'AsyncRequireError', 'MetroServerError']);
const NETWORK_ERROR_MESSAGE = /Loading module\b.*\bfailed|Loading chunk|dynamically imported module|Failed to load split bundle|Failed to fetch|Network request failed/i;

export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return NETWORK_ERROR_NAMES.has(error.name) || NETWORK_ERROR_MESSAGE.test(error.message);
}

type Leave = { kind: 'back' | 'close'; onPress: () => void } | null;

function RouteErrorScreen({ error, onRetry, leave }: { error: unknown; onRetry: () => void; leave: Leave }) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const padding = useTabBarPadding();
  const connection = isConnectionError(error);
  const pathname = usePathname();
  // A render error is reported once (the class boundary below adds its component stack); a lost connection is not a bug.
  useEffect(() => {
    if (!connection) reportClientError(error, pathname);
  }, [connection, error, pathname]);
  // §8 error state: the plain cause and what to do next. A render error is not the member's connection, and on web the retry is a reload.
  const title = connection ? t('states.errorTitle') : t('shell.routeError.title');
  const message = connection
    ? t('states.errorBody')
    : t(leave === null ? 'shell.routeError.bodyAlone' : leave.kind === 'close' ? 'shell.routeError.bodyClose' : 'shell.routeError.bodyBack');
  return (
    <Screen edges={EDGES} testID="shell.routeError.root">
      {leave ? <Header onBack={leave.onPress} backIcon={leave.kind} testID="shell.routeError.header" /> : null}
      <ShellOfflineBanner />
      <ErrorState
        title={title}
        message={message}
        onRetry={onRetry}
        retryLabel={isWeb ? t('shell.routeError.reload') : undefined}
        style={[styles.body, padding]}
        testID="shell.routeError"
      />
    </Screen>
  );
}

/** What a route reads of the navigation tree: enough to find the navigator that presents the modal group. */
type NavigationNode = {
  getParent: () => NavigationNode | undefined;
  getState: () => { routes: readonly { name: string }[] } | undefined;
  canGoBack: () => boolean;
  goBack: () => void;
};

/**
 * In the modal group the header's leading control is ×, which closes the whole group (§9; GAR-03, GAR-04 and the viewer do the same
 * through their own headers), so the fallback keeps that control and its meaning. A direct link with nothing below the modal goes to
 * Start. Elsewhere it is the back chevron, when there is something to go back to.
 */
function useLeave(): Leave {
  const router = useRouter();
  const navigation = useNavigation<NavigationNode>();
  const inModal = useSegments()[0] === MODAL_GROUP;
  if (inModal) {
    return {
      kind: 'close',
      onPress: () => {
        let presenter: NavigationNode | undefined = navigation;
        while (presenter && !presenter.getState()?.routes.some((route) => route.name === MODAL_GROUP)) presenter = presenter.getParent();
        if (presenter?.canGoBack()) presenter.goBack();
        else router.replace('/');
      },
    };
  }
  return router.canGoBack() ? { kind: 'back', onPress: () => router.back() } : null;
}

/**
 * BH-00: the root layout's `unstable_settings.screenErrorBoundary`, so expo-router puts it around each screen, below every Stack. A
 * boundary around a Stack unmounts that Stack, and React Navigation then clears its state. Around the root Stack that sent the pathname
 * to the first root route, /sign-in; SessionHost sent a signed-in member from there to '/', and that remounted the root layout with a
 * fresh boundary: Start, with no message. Here the stacks stay, so does the address, and back leads to the screen below.
 */
export function RouteErrorFallback({ error, retry }: ErrorBoundaryProps) {
  const leave = useLeave();
  return (
    <RouteErrorScreen
      error={error}
      onRetry={() => {
        if (isWeb) window.location.reload();
        else void retry();
      }}
      leave={leave}
    />
  );
}

type State = { error: unknown; failed: boolean };

/**
 * The last line, for what throws outside a screen: a layout, or a Stack itself. A screen that throws, or a route chunk that cannot
 * load because the connection is gone (web loads routes lazily), has `RouteErrorFallback`. Inside a tab stack the bars stay usable.
 * React keeps a rejected lazy route for the life of the page, so on web only a reload can try that chunk again.
 */
export class RouteErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (!isConnectionError(error)) reportClientError(error, isWeb && typeof window !== 'undefined' ? window.location.pathname : 'root', info.componentStack);
  }

  private retry = () => {
    if (isWeb) window.location.reload();
    else this.setState({ error: null, failed: false });
  };

  override render() {
    return this.state.failed ? <RouteErrorScreen error={this.state.error} onRetry={this.retry} leave={null} /> : this.props.children;
  }
}
