import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { createStyles, useBreakpoint } from '@/theme';
import { Button, Header, Screen, Text } from '@/ui';

/** No tab bar on this route. The Header pads the top; the screen pads the other edges. */
const EDGES: readonly Edge[] = ['bottom', 'left', 'right'];

const useStyles = createStyles((t) => ({
  content: { flex: 1, justifyContent: 'center' },
  block: { gap: t.space[8] },
  // From 768 the block is a 480 column in the middle of the window, its text still on the left: three quarters of the feed.
  blockCentred: { alignSelf: 'center', maxWidth: (t.layout.feedColumn * 3) / 4, width: '100%' },
  home: { marginTop: t.space[8] },
}));

export type NotFoundScreenProps = {
  /** M1.7 passes the "QR revoked" copy here; the layout stays. */
  title?: string;
  body?: string;
};

/** SYS-03: link not found, and later the QR-revoked state of /c/[code]. */
export function NotFoundScreen({ title, body }: NotFoundScreenProps) {
  const { t } = useTranslation('common');
  const { gutter, kind } = useBreakpoint();
  const styles = useStyles();
  const router = useRouter();
  return (
    <Screen edges={EDGES} testID="SYS-03.screen">
      <Header onBack={router.canGoBack() ? () => router.back() : undefined} testID="SYS-03.header" />
      <View style={[styles.content, { paddingHorizontal: gutter }]} testID="SYS-03.root">
        <View style={[styles.block, kind === 'phone' ? null : styles.blockCentred]} testID="SYS-03.block">
          <Text variant="titleL" role="heading" aria-level={1} testID="SYS-03.title">
            {title ?? t('notFound.title')}
          </Text>
          <Text color="text.secondary" testID="SYS-03.body">
            {body ?? t('notFound.body')}
          </Text>
          <Link href="/" replace asChild>
            <Button label={t('notFound.home')} role="link" variant="primary" size="m" style={styles.home} testID="SYS-03.home" />
          </Link>
        </View>
      </View>
    </Screen>
  );
}
