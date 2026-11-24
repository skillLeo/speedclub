import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCrewsOn, useMemberCrews } from '@/api/queries/crews';
import { createStyles } from '@/theme';
import { Chip } from '@/ui/Chip';
import { Text } from '@/ui/Text';

import { crewPath, roleLabel } from '../model';

const useStyles = createStyles((t) => ({
  root: { gap: t.space[8], marginTop: t.space[12] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8] },
}));

/**
 * PROF-02 (R4DQ-11): true while the member's crews are on their way, from the first frame on (the query starts beside the profile's
 * own). The page keeps its identity skeleton until then, so the chips never push the actions and tabs down. A failed first answer
 * ends the wait: the page shows without chips.
 */
export function useMemberCrewsSettling(username: string | null | undefined): boolean {
  const on = useCrewsOn();
  const query = useMemberCrews(on ? username : null);
  return on && Boolean(username) && query.isPending && query.fetchStatus === 'fetching' && query.failureCount === 0;
}

/**
 * PROF-02 (11 R4-2.3 "a crew chip on the member profile", contract §3 #4): the member's crews (≤ 5, A–Z) as chips that open CREW-01;
 * the founder's chip says so ("Nordlicht Crew · Gründer"). Nothing while the flag is off, while loading or when the member has none.
 * They sit under the profile's meta line, in the identity block above Folgen/Nachricht (R4DQ-33).
 */
export function CrewChips({ username, routeId }: { username: string | null | undefined; routeId: string }) {
  const { t } = useTranslation('discover', { keyPrefix: 'crews' });
  const styles = useStyles();
  const router = useRouter();
  const on = useCrewsOn();
  const query = useMemberCrews(on ? username : null);
  const crews = query.data ?? [];
  if (!on || crews.length === 0) return null;
  return (
    <View style={styles.root} testID={`${routeId}.crews`}>
      <Text variant="caption" color="text.secondary" role="heading" aria-level={2}>
        {t('chips.title')}
      </Text>
      <View style={styles.chips}>
        {crews.map((crew) => {
          const label = crew.role === 'founder' ? `${crew.name} · ${roleLabel(t, 'founder')}` : crew.name;
          return (
            <Chip
              key={crew.id}
              label={label}
              icon="users"
              wrap
              accessibilityLabel={t('chips.open', { name: label })}
              onPress={() => router.push(crewPath(crew.slug) as Href)}
              testID={`${routeId}.crews.${crew.slug}`}
            />
          );
        })}
      </View>
    </View>
  );
}
