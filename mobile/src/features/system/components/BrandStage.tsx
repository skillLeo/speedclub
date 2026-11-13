import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { ScrollView, View, type ViewProps } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

import { AppWordmark } from '@/features/auth/AppWordmark';
import { createStyles, layout, ThemeScope, useBreakpoint, type ThemeName } from '@/theme';
import { Photo, Screen, Text, type PhotoFields } from '@/ui';
import { PhotoStageScrim } from '@/ui/PhotoStageScrim';

/** §2 brand layer (ADR-143, DQ-102): the system states are a Carbon stage in every theme, like Welcome. */
const BRAND_THEME: ThemeName = 'carbon';
/**
 * DQ-1045: on web `data-theme-scope="carbon"` tells the DOM audit to check the stage's colours against Carbon's tokens in every page
 * theme (as ONB and the splash). The cast stands until `QaDataSet` (src/lib/rn-web-dataset.d.ts) lists `themeScope`.
 */
const STAGE_SCOPE = { themeScope: BRAND_THEME } as ViewProps['dataSet'];
const PHONE_EDGES: readonly Edge[] = ['bottom', 'left', 'right'];
const WIDE_EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right'];

const useStyles = createStyles((t) => ({
  root: { backgroundColor: t.color.bg.canvas },
  scope: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  // Phones: the photo full-bleed at the top, 4:5, fading into the stage (09 §4.6); the copy stands on the stage under it.
  photo: { width: '100%' },
  content: { flexGrow: 1, gap: t.space[8], paddingBottom: t.space[32] },
  logo: { marginBottom: t.space[16] },
  detail: { marginTop: t.space[4] },
  actions: { alignItems: 'stretch', gap: t.space[12], marginTop: t.space[24] },
  // From 768: the AUTH-02 split (DQ-1088): the photo on 7 of 12 columns, edge to edge; the copy in a readable column on the other 5.
  split: { flex: 1, flexDirection: 'row' },
  // Explicit basis 0 and no minimum width: the photo's own width must never squeeze the copy column (r2: the copy got 64 px).
  photoPane: { flexBasis: 0, flexGrow: 7, flexShrink: 1, minWidth: 0, overflow: 'hidden' },
  copyPane: { flexBasis: 0, flexGrow: 5, flexShrink: 1, minWidth: 0 },
  copyContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: t.space[48] },
  column: { gap: t.space[8], maxWidth: (layout.feedColumn * 3) / 4, width: '100%' },
  // The pane decides the photo's shape: it fills the left half, cropped around the focal point.
  photoFill: { aspectRatio: undefined, flex: 1 },
}));

export type BrandStageProps = {
  /** `<ROUTE-ID>.root`, `.state`, `.state.title`, `.state.body`, `.detail`, `.logo`, `.photo`. */
  routeId: string;
  photo: PhotoFields;
  title: string;
  body: string;
  hyphenateBody?: boolean;
  /** A caption under the body (installed and required version). */
  detail?: string;
  /** The buttons, first the one filled CTA. */
  actions: ReactNode;
  /** A transparent header over the photo (SYS-03's back, `Header variant="photo"`), on phones and wide screens alike. */
  header?: ReactNode;
};

/**
 * 09 §7.14 photo-backed brand state (SYS-01 update, SYS-02 maintenance, SYS-03 not found / revoked / private): a full-bleed night
 * photo that fades into the Carbon stage, the small wordmark, `title.1`, one body line, the actions — left-aligned, one filled CTA,
 * never a centred hero. The copy scrolls at 200 % so nothing leaves the screen. Text never sits on the photo.
 */
export function BrandStage({ routeId, photo, title, body, hyphenateBody, detail, actions, header }: BrandStageProps) {
  return (
    <ThemeScope name={BRAND_THEME}>
      <ScopedStage>
        <BrandStageBody routeId={routeId} photo={photo} title={title} body={body} hyphenateBody={hyphenateBody} detail={detail} actions={actions} header={header} />
      </ScopedStage>
    </ThemeScope>
  );
}

function ScopedStage({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.scope} dataSet={STAGE_SCOPE}>
      {children}
    </View>
  );
}

function BrandStageBody({ routeId, photo, title, body, hyphenateBody, detail, actions, header }: BrandStageProps) {
  const styles = useStyles();
  const { gutter, kind } = useBreakpoint();
  const wide = kind !== 'phone';
  const copy = (
    <>
      <AppWordmark width={layout.sidebar / 2} style={styles.logo} testID={`${routeId}.logo`} />
      <Text variant="title1" role="heading" {...({ 'aria-level': 1 } as object)} testID={`${routeId}.state.title`}>
        {title}
      </Text>
      <Text variant="body" color="text.secondary" hyphenate={hyphenateBody} testID={`${routeId}.state.body`}>
        {body}
      </Text>
      {detail ? (
        <Text variant="caption" color="text.tertiary" style={styles.detail} testID={`${routeId}.detail`}>
          {detail}
        </Text>
      ) : null}
      <View style={styles.actions}>{actions}</View>
    </>
  );
  const image = (
    <Photo {...photo} aspect={wide ? '16:9' : '4:5'} corner="none" style={wide ? styles.photoFill : styles.photo} testID={`${routeId}.photo`}>
      <PhotoStageScrim />
    </Photo>
  );

  if (wide) {
    return (
      <Screen edges={WIDE_EDGES} style={styles.root} testID={`${routeId}.root`}>
        <StatusBar style="light" />
        <View style={styles.split}>
          <View style={styles.photoPane} dataSet={{ qaExempt: 'photo' }}>
            {image}
          </View>
          <ScrollView style={styles.copyPane} contentContainerStyle={[styles.copyContent, { paddingHorizontal: gutter * 2 }]}>
            <View style={styles.column} testID={`${routeId}.state`}>
              {copy}
            </View>
          </ScrollView>
        </View>
        {header}
      </Screen>
    );
  }
  return (
    <Screen edges={PHONE_EDGES} style={styles.root} testID={`${routeId}.root`}>
      <StatusBar style="light" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} bounces={false}>
        <View dataSet={{ qaExempt: 'photo' }}>{image}</View>
        <View style={[styles.content, { paddingHorizontal: gutter }]} testID={`${routeId}.state`}>
          {copy}
        </View>
      </ScrollView>
      {header}
    </Screen>
  );
}
