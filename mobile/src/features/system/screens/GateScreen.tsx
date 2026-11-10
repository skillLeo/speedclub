import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { useAppConfig } from '@/api/queries/appConfig';
import { createStyles, layout, size, space, useBreakpoint, useTheme } from '@/theme';
import { AppWordmark } from '@/features/auth/AppWordmark';
import { Button, EmptyState, estimateLines, Screen, Text } from '@/ui';

const EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right'];
/** DQ-093: up to here a centred text still reads as one line of the brand moment. Longer, the eye needs a left edge to return to (§15). */
const CENTRED_BODY_MAX_LINES = 3;

const useStyles = createStyles((t) => ({
  content: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: t.space[24] },
  logo: { marginBottom: t.space[8] },
  longScroll: { flex: 1 },
  longContent: { flexGrow: 1, justifyContent: 'center', padding: t.space[24] },
  longColumn: { alignItems: 'flex-start', alignSelf: 'center', maxWidth: t.size.dialogMaxWidth, paddingHorizontal: t.space[16], width: '100%' },
  longLogo: { marginBottom: t.space[24] },
  longBody: { marginTop: t.space[8] },
  longAction: { marginTop: t.space[24] },
  detail: { marginTop: t.space[8] },
  shortDetail: { marginTop: t.space[8], textAlign: 'center' },
  actions: { alignItems: 'center', gap: t.space[12], marginTop: t.space[24] },
  longActions: { alignItems: 'flex-start', gap: t.space[12], marginTop: t.space[24] },
}));

type GateAction = { label: string; onPress: () => void; loading?: boolean };

type Props = {
  routeId: string;
  title: string;
  body: string;
  hyphenateBody?: boolean;
  /** A line under the body, for example the installed and the required version. */
  detail?: string;
  /** SYS-01's way out of the gate, above "Erneut prüfen": the store or the get-the-app page. */
  primary?: GateAction;
};

/** The width of the gate's body: the state's column inside the screen's padding, as EmptyState lays it out. */
export function gateBodyWidth(windowWidth: number): number {
  return Math.min(size.dialogMaxWidth, windowWidth - 2 * space[24]) - 2 * space[16];
}

/**
 * SYS-01 and SYS-02, brand layer (ADR-143): the small wordmark, one line, and the way out: the store for an update, "Erneut
 * prüfen" for both. The app-config poll lifts the gate by itself as soon as the server allows it.
 */
export function GateScreen({ routeId, title, body, hyphenateBody, detail, primary }: Props) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const { fontScale } = useTheme();
  const { width } = useBreakpoint();
  const { refetch, isFetching } = useAppConfig();
  const label = t('gate.checkAgain');
  const logo = { width: layout.sidebar / 2, testID: `${routeId}.logo` };

  // A message the team wrote can be of any length, and it scrolls rather than leaving the screen at a large font.
  if (estimateLines(body.length, 'bodyDense', fontScale, gateBodyWidth(width)) > CENTRED_BODY_MAX_LINES) {
    return (
      <Screen edges={EDGES} testID={`${routeId}.root`}>
        <ScrollView style={styles.longScroll} contentContainerStyle={styles.longContent}>
          <View style={styles.longColumn} testID={`${routeId}.state`}>
            <AppWordmark {...logo} style={styles.longLogo} />
            <Text variant="titleS" role="heading" {...({ 'aria-level': 2 } as object)} testID={`${routeId}.state.title`}>
              {title}
            </Text>
            <Text variant="bodyDense" color="text.secondary" hyphenate={hyphenateBody} style={styles.longBody} testID={`${routeId}.state.body`}>
              {body}
            </Text>
            {detail ? (
              <Text variant="caption" color="text.tertiary" style={styles.detail} testID={`${routeId}.detail`}>
                {detail}
              </Text>
            ) : null}
            <View style={primary ? styles.longActions : null}>
              {primary ? (
                <Button label={primary.label} size="m" loading={primary.loading} onPress={primary.onPress} testID={`${routeId}.store`} />
              ) : null}
              <Button
                label={label}
                variant="secondary"
                size="m"
                loading={isFetching}
                onPress={() => void refetch()}
                style={primary ? null : styles.longAction}
                testID={`${routeId}.state.action`}
              />
            </View>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen edges={EDGES} testID={`${routeId}.root`}>
      <View style={styles.content}>
        <AppWordmark {...logo} style={styles.logo} />
        <EmptyState
          title={title}
          body={body}
          hyphenateBody={hyphenateBody}
          action={
            primary
              ? undefined
              : {
                  label,
                  variant: 'secondary',
                  size: 'm',
                  loading: isFetching,
                  onPress: () => void refetch(),
                }
          }
          testID={`${routeId}.state`}
        />
        {detail ? (
          <Text variant="caption" color="text.tertiary" style={styles.shortDetail} testID={`${routeId}.detail`}>
            {detail}
          </Text>
        ) : null}
        {primary ? (
          <View style={styles.actions}>
            <Button label={primary.label} size="m" loading={primary.loading} onPress={primary.onPress} testID={`${routeId}.store`} />
            <Button label={label} variant="secondary" size="m" loading={isFetching} onPress={() => void refetch()} testID={`${routeId}.state.action`} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
