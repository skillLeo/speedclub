import { router, type Href } from 'expo-router';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { createStyles, useBreakpoint } from '@/theme';
import { Header, HeaderLargeTitle, ListRow, Screen, Text, useCollapsingHeader } from '@/ui';

import { SECTIONS } from '../data';

const useStyles = createStyles((t) => ({
  scroll: { flex: 1 },
  content: { paddingBottom: t.space[64] },
  column: { alignSelf: 'center', maxWidth: t.layout.feedColumn, width: '100%' },
  // The scroll content already holds the gutter, so the title block adds none of its own.
  title: { paddingHorizontal: 0 },
  intro: { marginBottom: t.space[20] },
  list: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, overflow: 'hidden' },
}));

/** DEV-01: index of the component gallery. It only exists outside production, see src/app/dev/gallery. */
export function GalleryIndexScreen() {
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  const scroll = useCollapsingHeader();
  return (
    <Screen edges={['left', 'right']} testID="DEV-01.root">
      <Header variant="large" title="Galerie" scroll={scroll} testID="DEV-01.header" />
      <Animated.ScrollView
        {...scroll.scrollProps}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingHorizontal: gutter }]}
      >
        <View style={styles.column}>
          <HeaderLargeTitle title="Galerie" scroll={scroll} style={styles.title} />
          <Text variant="body" color="text.secondary" style={styles.intro}>
            Jede Komponente in jedem Zustand aus §8, mit echten Daten.
          </Text>
          <View style={styles.list}>
            {SECTIONS.map((section, index) => (
              <ListRow
                key={section.id}
                title={section.title}
                subtitle={section.hint}
                inset={16}
                divider={index < SECTIONS.length - 1}
                onPress={() => router.push(`/dev/gallery/${section.id}` as Href)}
                testID={`DEV-01.link.${section.id}`}
              />
            ))}
          </View>
        </View>
      </Animated.ScrollView>
    </Screen>
  );
}
