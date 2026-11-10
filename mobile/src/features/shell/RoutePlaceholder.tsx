import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { createStyles } from '@/theme';
import { EmptyState, Header, Screen } from '@/ui';

import { ShellOfflineBanner } from './ShellOfflineBanner';
import { useTabBarPadding } from './tabBarLayout';

const useStyles = createStyles(() => ({
  body: { flex: 1, justifyContent: 'center' },
}));

export type RoutePlaceholderProps = {
  /** From the register: sets `<ROUTE-ID>.root`. */
  routeId: string;
  /** In the `common` namespace, under `routes`. */
  titleKey: `routes.${string}`;
  /** `modal` closes with ×. */
  presentation?: 'push' | 'modal';
  /** Replaces `<ROUTE-ID>.header`, so `.back` keeps the ID a spec relies on. */
  headerTestID?: string;
  children?: ReactNode;
};

const IN_TAB: readonly Edge[] = ['left', 'right'];
const STANDALONE: readonly Edge[] = ['left', 'right', 'bottom'];

/**
 * The neutral state of a route whose feature module has not landed yet. A feature module replaces the one line in the
 * route file with its screen; nothing else changes. See features/shell/README.md.
 */
export function RoutePlaceholder({ routeId, titleKey, presentation = 'push', headerTestID, children }: RoutePlaceholderProps) {
  const { t } = useTranslation('common');
  const router = useRouter();
  const styles = useStyles();
  const padding = useTabBarPadding();
  const inTab = Object.keys(padding).length > 0;

  return (
    <Screen edges={inTab ? IN_TAB : STANDALONE} testID={`${routeId}.root`}>
      <Header
        title={t(titleKey)}
        backIcon={presentation === 'modal' ? 'close' : 'back'}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        testID={headerTestID ?? `${routeId}.header`}
      />
      <ShellOfflineBanner />
      <View style={[styles.body, padding]}>
        <EmptyState
          icon="wrench"
          title={t('states.comingSoon')}
          body={t('shell.placeholderBody')}
          testID={`${routeId}.placeholder`}
        />
        {children}
      </View>
    </Screen>
  );
}
