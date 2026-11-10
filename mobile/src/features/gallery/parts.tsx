import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, useBreakpoint } from '@/theme';
import { Header, Screen, Text } from '@/ui';
import { EagerImagesProvider, ForcedVisualStateProvider, type ForcedVisualState } from '@/ui/qaVisualState';

import { SECTIONS, type SectionId } from './data';

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { paddingBottom: t.space[64], paddingTop: t.space[16] },
  column: { alignSelf: 'center', gap: t.layout.sectionGap, maxWidth: t.layout.feedColumn, width: '100%' },
  group: { gap: t.space[12] },
  groupBody: { gap: t.space[20] },
  note: { marginTop: -t.space[8] },
  specimen: { gap: t.space[8] },
  fill: { alignSelf: 'stretch' },
  wrap: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[16] },
  panel: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
  panelPadded: { padding: t.layout.cardPadding },
}));

type SectionScreenProps = {
  section: SectionId;
  footer?: ReactNode;
  /** For a section with no control in it: the keyboard could not reach its scroll area otherwise. */
  focusableScroll?: boolean;
  children: ReactNode;
};

export function SectionScreen({ section, footer, focusableScroll = false, children }: SectionScreenProps) {
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  const title = SECTIONS.find((s) => s.id === section)?.title;
  return (
    <EagerImagesProvider>
      <Screen edges={['left', 'right']} testID={`DEV-01.${section}.root`}>
        <Header
          variant="compact"
          title={title}
          onBack={() => router.navigate('/dev/gallery')}
          backLabel="Zurück zur Galerie"
          testID={`DEV-01.${section}.header`}
        />
        <ScrollView
          tabIndex={focusableScroll && isWeb ? 0 : undefined}
          style={styles.scroll}
          contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
        >
          <View style={styles.column}>{children}</View>
        </ScrollView>
        {footer}
      </Screen>
    </EagerImagesProvider>
  );
}

/** One component with a title and an optional line about what it shows. */
export function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <Text variant="titleS" role="heading" aria-level={2}>
        {title}
      </Text>
      {note ? (
        <Text variant="supporting" color="text.secondary" style={styles.note}>
          {note}
        </Text>
      ) : null}
      <View style={styles.groupBody}>{children}</View>
    </View>
  );
}

/** One state of a component with its small label. `forced` draws what only a pointer or a keyboard could reach. */
export function Specimen({
  label,
  forced,
  fill = false,
  style,
  children,
}: {
  label: string;
  forced?: ForcedVisualState;
  /** Takes the full width of the group. */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.specimen, fill ? styles.fill : null, style]}>
      <Text variant="caption" color="text.tertiary">
        {label}
      </Text>
      {forced ? <ForcedVisualStateProvider value={forced}>{children}</ForcedVisualStateProvider> : children}
    </View>
  );
}

export function Wrap({ children }: { children: ReactNode }) {
  return <View style={useStyles().wrap}>{children}</View>;
}

/** A list group on bg.surface, as rows and cards sit on a real screen. */
export function Panel({ padded = false, children }: { padded?: boolean; children: ReactNode }) {
  const styles = useStyles();
  return <View style={[styles.panel, padded ? styles.panelPadded : null]}>{children}</View>;
}

/** Backs out of the section's gutter: edge-to-edge components bring their own, as they do on a real screen. */
export function FullBleed({ children }: { children: ReactNode }) {
  const { gutter } = useBreakpoint();
  return <View style={{ marginHorizontal: -gutter }}>{children}</View>;
}

/** The interaction states that need a forced visual. */
export const FORCED: readonly { label: string; state: ForcedVisualState }[] = [
  { label: 'Hover', state: { hovered: true } },
  { label: 'Gedrückt', state: { pressed: true } },
  { label: 'Fokus', state: { focused: true } },
];
