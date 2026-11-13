import { StatusBar } from 'expo-status-bar';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, useWindowDimensions, View, type ViewProps } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Edge } from 'react-native-safe-area-context';

import { useFlag } from '@/api/queries/appConfig';
import { useTabBarInset } from '@/features/shell/tabBarLayout';
import { NotFoundScreen } from '@/features/system/screens/NotFoundScreen';
import { useQaState } from '@/lib/qa';
import { useOnline } from '@/state/online';
import { createStyles, layout, size, ThemeScope, useBreakpoint, type ThemeName } from '@/theme';
import {
  Button,
  DisplayTitle,
  Header,
  ListRow,
  OfflineBanner,
  Photo,
  SampleBadge,
  Screen,
  Skeleton,
  SkeletonBlock,
  SkeletonText,
  Text,
  type IconName,
  type PhotoFields,
  useCollapsingHeader,
} from '@/ui';
import { PhotoStageScrim } from '@/ui/PhotoStageScrim';
import { RowGroup } from '@/ui/RowGroup';

export const MEMBERSHIP_FLAG = 'membership';

/** A licensed seed photo (design/seed-photos/CREDITS.md): an E46 at night, plate blurred. Focal point and blurhash from the manifest. */
const MEMBERSHIP_PHOTO: PhotoFields = {
  source: require('@/assets/gallery/bmw-e46-01.jpg') as number,
  blurhash: 'LVEeGM-UE2V@}mxYR-jZ-QoJWXoL',
  focal: { x: 0.49, y: 0.59 },
};

/** The candidate perks of 09 §8.16, no numbers: none is decided yet (09 §16 #14, client sign-off), so the list is a sample. */
const PERKS: readonly { key: string; icon: IconName }[] = [
  { key: 'garage', icon: 'garage-bay' },
  { key: 'photos', icon: 'image' },
  { key: 'stickers', icon: 'qr-sticker' },
  { key: 'costs', icon: 'chart-bar' },
  { key: 'accent', icon: 'circle-half' },
];

/** §2 brand layer (ADR-143, ADR-440): like Welcome, ONB and the system states, the paywall is a Carbon stage in every theme. */
const BRAND_THEME: ThemeName = 'carbon';
const STAGE_SCOPE = { themeScope: BRAND_THEME } as ViewProps['dataSet'];
const PHONE_EDGES: readonly Edge[] = ['bottom', 'left', 'right'];
const WIDE_EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right'];

const useStyles = createStyles((t) => ({
  root: { backgroundColor: t.color.bg.canvas },
  scope: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  photo: { width: '100%' },
  photoFill: { aspectRatio: undefined, flex: 1 },
  content: { gap: t.space[32], paddingBottom: t.space[48], paddingTop: t.space[8] },
  intro: { gap: t.space[8] },
  sectionHead: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], marginBottom: t.space[12] },
  price: { gap: t.space[4] },
  actions: { gap: t.space[12] },
  legal: { alignItems: 'center', columnGap: t.space[4], flexDirection: 'row', flexWrap: 'wrap' },
  legalLink: { justifyContent: 'center', minHeight: t.size.touchMin, minWidth: t.size.touchMin, paddingHorizontal: t.space[4] },
  split: { flex: 1, flexDirection: 'row' },
  photoPane: { flexBasis: 0, flexGrow: 7, flexShrink: 1, minWidth: 0, overflow: 'hidden' },
  copyPane: { flexBasis: 0, flexGrow: 5, flexShrink: 1, minWidth: 0 },
  copyContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: t.space[48] },
  column: { maxWidth: layout.feedColumn, width: '100%' },
  skeleton: { gap: t.space[16] },
}));

export type MembershipScreenProps = {
  /** MEM-01 at /membership, SET-24 at /settings/membership: the same page, its own test ids. */
  routeId: 'MEM-01' | 'SET-24';
};

/**
 * MEM-01 Mitgliedschaft (09 §7.13, §8.16; flag `membership`, off): the paywall scaffold. A full-bleed night photo fading into the
 * Carbon stage; the plan in `display.title`; "Kommt bald"; the candidate perks as real list rows under a "Beispiel" badge (none is
 * decided yet); no price, only that prices come before anything can be bought, "Jederzeit kündbar"; the purchase button disabled
 * with "Bald verfügbar"; AGB and Datenschutz. No countdown, no fake price, no count. "Käufe wiederherstellen" waits for store
 * billing: with nothing to buy there is nothing to restore, and a dead control is not shown (09 §7.15).
 * Flag off: the page does not exist (SYS-03), whether the link is old or typed.
 */
export function MembershipScreen({ routeId }: MembershipScreenProps) {
  const enabled = useFlag(MEMBERSHIP_FLAG);
  const styles = useStyles();
  if (!enabled) return <NotFoundScreen />;
  return (
    <ThemeScope name={BRAND_THEME}>
      <View style={styles.scope} dataSet={STAGE_SCOPE}>
        <MembershipStage routeId={routeId} />
      </View>
    </ThemeScope>
  );
}

function MembershipStage({ routeId }: MembershipScreenProps) {
  const { t } = useTranslation('settings');
  const styles = useStyles();
  const router = useRouter();
  const online = useOnline();
  const qaState = useQaState();
  const { gutter, kind } = useBreakpoint();
  const { width } = useWindowDimensions();
  const wide = kind !== 'phone';
  // The copy column's width before its first layout (DisplayTitle MF-R2-1): the phone's content, or 5 of 12 columns less its padding.
  const titleWidth = wide ? Math.min(layout.feedColumn, (width * 5) / 12 - gutter * 4) : width - gutter * 2;
  const fallback: Href = routeId === 'SET-24' ? '/settings' : '/profile';
  const back = () => (router.canGoBack() ? router.back() : router.replace(fallback));
  const loading = qaState === 'loading';
  const scroll = useCollapsingHeader();
  // The phone's 4:5 photo: where the bar turns solid.
  const photoHeight = (width * 5) / 4;
  // The page lives in the Profil tab: its end stays above the floating tab bar.
  const tabBar = useTabBarInset();
  const offline = !online || qaState === 'offline';

  const image = (
    <Photo
      {...MEMBERSHIP_PHOTO}
      aspect={wide ? '16:9' : '4:5'}
      corner="none"
      style={wide ? styles.photoFill : styles.photo}
      testID={`${routeId}.photo`}
    >
      <PhotoStageScrim />
    </Photo>
  );

  const body = loading ? (
    <Skeleton testID={`${routeId}.skeleton`}>
      <View style={styles.skeleton}>
        <SkeletonText variant="caption" width="25%" />
        <SkeletonText variant="displayTitle" width="80%" />
        <SkeletonText variant="body" lines={2} />
        <SkeletonBlock height={size.row.withThumb * PERKS.length} corner="md" />
        <SkeletonBlock height={size.button.l} corner="sm" />
      </View>
    </Skeleton>
  ) : (
    <View style={styles.content} testID={`${routeId}.content`}>
      <View style={styles.intro}>
        <Text variant="callout" color="text.secondary" testID={`${routeId}.soon`}>
          {t('membership.soon')}
        </Text>
        <DisplayTitle kind="copy" placement="page" layoutWidth={titleWidth} role="heading" testID={`${routeId}.plan`}>
          {t('membership.plan')}
        </DisplayTitle>
        <Text variant="body" color="text.secondary" testID={`${routeId}.lead`}>
          {t('membership.lead')}
        </Text>
      </View>
      <View>
        <View style={styles.sectionHead}>
          <Text variant="calloutStrong" role="heading" {...({ 'aria-level': 2 } as object)}>
            {t('membership.perksTitle')}
          </Text>
          <SampleBadge testID={`${routeId}.sample`} />
        </View>
        <RowGroup testID={`${routeId}.perks`}>
          {PERKS.map((perk, index) => (
            <ListRow
              key={perk.key}
              icon={perk.icon}
              title={t(`membership.perks.${perk.key}`)}
              subtitle={t(`membership.perks.${perk.key}Body`)}
              divider={index < PERKS.length - 1}
              testID={`${routeId}.perk.${perk.key}`}
            />
          ))}
        </RowGroup>
      </View>
      <View style={styles.price} testID={`${routeId}.price`}>
        <Text variant="headline">{t('membership.priceTitle')}</Text>
        <Text variant="body" color="text.secondary">
          {t('membership.priceBody')}
        </Text>
        <Text variant="body" color="text.secondary" testID={`${routeId}.cancel`}>
          {t('membership.cancelAnytime')}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button label={t('membership.cta')} size="l" fullWidth disabled testID={`${routeId}.cta`} />
        <View style={styles.legal}>
          {(['terms', 'privacy'] as const).map((doc, index) => (
            <View key={doc} style={styles.legal}>
              {index > 0 ? (
                <Text variant="caption" color="text.tertiary" aria-hidden>
                  ·
                </Text>
              ) : null}
              <Button
                label={t(`membership.legal.${doc}`)}
                variant="tertiary"
                size="s"
                role="link"
                onPress={() => router.push({ pathname: '/settings/legal/[doc]', params: { doc } })}
                testID={`${routeId}.legal.${doc}`}
              />
            </View>
          ))}
        </View>
      </View>
    </View>
  );

  // Over the photo the bar is clear; once the photo has scrolled away it turns solid with the plan's name (09 §6.2 b).
  const header = (
    <Header
      variant="photo"
      title={t('membership.plan')}
      scroll={wide ? undefined : scroll}
      collapseAt={photoHeight}
      onBack={back}
      hairline={false}
      testID={`${routeId}.header`}
    />
  );
  const banner = offline ? <OfflineBanner label={t('membership.offline')} testID={`${routeId}.offline`} /> : null;

  if (wide) {
    return (
      <Screen edges={WIDE_EDGES} style={styles.root} testID={`${routeId}.root`}>
        <StatusBar style="light" />
        <View style={styles.split}>
          <View style={styles.photoPane} dataSet={{ qaExempt: 'photo' }}>
            {image}
          </View>
          <ScrollView
            style={styles.copyPane}
            contentContainerStyle={[styles.copyContent, { paddingBottom: styles.copyContent.paddingVertical + tabBar, paddingHorizontal: gutter * 2 }]}
          >
            {banner}
            <View style={styles.column}>{body}</View>
          </ScrollView>
        </View>
        {header}
      </Screen>
    );
  }
  return (
    <Screen edges={PHONE_EDGES} style={styles.root} testID={`${routeId}.root`}>
      <StatusBar style="light" />
      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBar }]}
        bounces={false}
        {...scroll.scrollProps}
      >
        <View dataSet={{ qaExempt: 'photo' }}>{image}</View>
        <View style={{ paddingHorizontal: gutter }}>
          {banner}
          {body}
        </View>
      </Animated.ScrollView>
      {header}
    </Screen>
  );
}
