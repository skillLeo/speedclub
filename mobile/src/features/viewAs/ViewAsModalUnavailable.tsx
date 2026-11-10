import { View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { createStyles, useBreakpoint } from '@/theme';
import { Header, Screen } from '@/ui';

import { ViewAsUnavailable } from './ViewAsUnavailable';

const EDGES: readonly Edge[] = ['left', 'right'];

const useStyles = createStyles((t) => ({
  body: { flexGrow: 1, justifyContent: 'center', paddingVertical: t.space[32] },
}));

export type ViewAsModalUnavailableProps = {
  /** The modal's own title, so the frame reads as the screen it stands in for ("Neue Nachricht"). */
  title: string;
  onClose: () => void;
  /** The route the state stands in for, e.g. `MSG-03`: its root and header keep their testIDs. */
  routeId: string;
};

/**
 * A modal messaging route in a view-as tab (M3.5 view-as leftovers, ADR-227): the modal's frame with its close control and the
 * designed "In der Ansicht als Mitglied nicht verfügbar" state in place of the screen, never the refusal of a request. Nothing of
 * messaging mounts, so nothing asks the server for it.
 */
export function ViewAsModalUnavailable({ title, onClose, routeId }: ViewAsModalUnavailableProps) {
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      <Header title={title} onBack={onClose} backIcon="close" testID={`${routeId}.header`} />
      <View style={[styles.body, { paddingHorizontal: gutter }]}>
        <ViewAsUnavailable kind="messages" testID="VIEWAS.messages" />
      </View>
    </Screen>
  );
}
