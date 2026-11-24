import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useForumOn, useVehicleForumThreads, type ForumThreadRow } from '@/api/queries/forum';
import type { PublicVehicle } from '@/api/queries/vehicles';
import { useRequireAuth } from '@/state/session';
import { createStyles } from '@/theme';
import { Button } from '@/ui/Button';
import { Hairline } from '@/ui/Hairline';
import { SectionHeader } from '@/ui/SectionHeader';
import { Text } from '@/ui/Text';

import { composerHref } from '../navigation';
import { ThreadRow } from './ThreadRow';

const useStyles = createStyles((t) => ({
  header: { paddingBottom: t.space[4] },
  owner: { alignItems: 'flex-start', gap: t.space[12], paddingTop: t.space[8] },
}));

/** Rows with hairlines between them, as a list for screen readers. */
function ThreadList({ threads, routeId }: { threads: readonly ForumThreadRow[]; routeId: string }) {
  return (
    <View role="list">
      {threads.map((thread, index) => (
        <View key={thread.id} role="listitem">
          {index > 0 ? <Hairline /> : null}
          <ThreadRow thread={thread} routeId={routeId} />
        </View>
      ))}
    </View>
  );
}

/**
 * HOME-01 "Gerade im Forum" (10 §7.4, §11): up to three threads active in the last 14 days (`forum/active`), "Zum Forum" to FOR-01.
 * The caller leaves the module out when the forum is quiet: never an empty or padded module.
 */
export function ForumActiveModule({ threads, routeId }: { threads: readonly ForumThreadRow[]; routeId: string }) {
  const { t } = useTranslation('forum');
  const styles = useStyles();
  const router = useRouter();
  if (threads.length === 0) return null;
  return (
    <View testID={`${routeId}.forum`}>
      <SectionHeader
        title={t('home.title')}
        actionLabel={t('home.all')}
        actionAccessibilityLabel={t('home.allLabel')}
        onAction={() => router.push('/forum' as Href)}
        style={styles.header}
        testID={`${routeId}.forum.header`}
      />
      <ThreadList threads={threads.slice(0, 3)} routeId={`${routeId}.forum`} />
    </View>
  );
}

/**
 * VEH-01 "Diskussionen zu diesem Build" (10 §5.12, §7.4): the newest threads that have this car attached. A visitor sees the section
 * only when there are threads; the owner, without threads, gets one line and "Thema starten" with the car attached. Nothing while the
 * `forum` flag is off (the slot's caller checks it as well).
 */
export function BuildDiscussions({
  vehicle,
  routeId,
  style,
}: {
  vehicle: PublicVehicle;
  routeId: string;
  /** The page's section gap below the block (DQ-P5-072); on the block itself, so a visitor without threads gets no empty gap. */
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation('forum');
  const styles = useStyles();
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const on = useForumOn();
  const threads = useVehicleForumThreads(vehicle.id, on && !vehicle.is_sample);
  const rows = threads.data ?? [];
  if (!on) return null;
  if (rows.length === 0) {
    if (!vehicle.is_owner || !threads.isSuccess) return null;
    return (
      <View style={style} testID={`${routeId}.discussions`}>
        <SectionHeader title={t('vehicle.title')} style={styles.header} testID={`${routeId}.discussions.header`} />
        <View style={styles.owner}>
          <Text variant="callout" color="text.secondary">
            {t('vehicle.ownerBody')}
          </Text>
          <Button
            label={t('vehicle.ownerAction')}
            variant="secondary"
            size="m"
            icon="chats"
            onPress={() => requireAuth(() => router.push(composerHref({ vehicleId: vehicle.id })))}
            testID={`${routeId}.discussions.start`}
          />
        </View>
      </View>
    );
  }
  return (
    <View style={style} testID={`${routeId}.discussions`}>
      <SectionHeader
        title={t('vehicle.title')}
        actionLabel={t('vehicle.all')}
        actionAccessibilityLabel={t('vehicle.allLabel')}
        onAction={() => router.push({ pathname: '/forum', params: { q: vehicle.full_title } } as unknown as Href)}
        style={styles.header}
        testID={`${routeId}.discussions.header`}
      />
      <ThreadList threads={rows.slice(0, 3)} routeId={`${routeId}.discussions`} />
    </View>
  );
}

