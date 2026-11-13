import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { PHOTOS } from '@/features/gallery/data';
import { QR_SAMPLE_SVG } from '@/features/gallery/qrSample';
import { createStyles, space } from '@/theme';
import { BuildSheet, DisplayTitle, Photo, QRDisplay, SampleBadge, SampleBadges, Text } from '@/ui';

/** ONB-01…03 (09 §7.1): one licensed night photo per page (design/seed-photos/CREDITS.md) and the live component composited on it. */
export type OnboardingPageKey = 'garage' | 'sheet' | 'qr';

export type OnboardingPage = {
  key: OnboardingPageKey;
  /** The screen id of the page: ONB-01, ONB-02, ONB-03. */
  id: string;
  photo: (typeof PHOTOS)[keyof typeof PHOTOS];
};

export const ONBOARDING_PAGES: readonly OnboardingPage[] = [
  { key: 'garage', id: 'ONB-01', photo: PHOTOS.wheels },
  { key: 'sheet', id: 'ONB-02', photo: PHOTOS.interior },
  { key: 'qr', id: 'ONB-03', photo: PHOTOS.r34 },
];

/** `?page=2` opens ONB-02 (the visual matrix's way in); anything else the first page. */
export function initialPage(param: string | string[] | undefined): number {
  const value = Number(Array.isArray(param) ? param[0] : param);
  return Number.isInteger(value) && value >= 1 && value <= ONBOARDING_PAGES.length ? value - 1 : 0;
}

const useStyles = createStyles((t) => ({
  // The live component's own ground: never text straight on the photo (09 §4.6). A surface, not glass (09 §4.4).
  panel: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.xl, gap: t.space[16], padding: t.space[16] },
  qr: { alignItems: 'center', gap: t.space[12] },
  // 09 §5 VehicleCard 2.0: the photo at the top of the card (radius 20 through the card's clip), the name and the mini spec below.
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.xl, overflow: 'hidden' },
  cardBadges: { left: t.space[12], position: 'absolute', top: t.space[12] },
  cardBody: { gap: t.space[12], padding: t.space[16] },
  // The mini spec: three cells in one row, hairline-free, numeral + unit on one line, the data label under it.
  spec: { flexDirection: 'row', gap: t.space[12] },
  specCell: { flex: 1, gap: t.space[2], minWidth: 0 },
  specValue: { alignItems: 'baseline', flexDirection: 'row', gap: t.space[2] },
}));

type MiniSpecItem = { key: string; value: string; unit?: string; label: string };

/**
 * 09 §5 SpecStrip, the card's mini form: three `hero.numeral.s` (tnum) with their `label.unit` and `label.caps` data label, in one
 * row (DQ-1035, DQ-1042: no empty fourth quadrant).
 */
function MiniSpec({ items, testID }: { items: readonly MiniSpecItem[]; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.spec} testID={testID}>
      {items.map((item) => (
        <View key={item.key} style={styles.specCell}>
          <View style={styles.specValue}>
            <Text variant="heroNumeralS" numeric hyphenate={false}>
              {item.value}
            </Text>
            {item.unit ? (
              <Text variant="labelUnit" color="text.secondary" hyphenate={false}>
                {item.unit}
              </Text>
            ) : null}
          </View>
          <Text variant="labelCaps" color="text.secondary" numberOfLines={1} hyphenate={false}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}


/**
 * The real components with badged sample data ("Beispiel"), not screenshots. They illustrate the page's line and are hidden from
 * screen readers, which read the title and the body (the sample car names would only add noise). `compact` (a short window, DQ-1023):
 * the card's photo is 4:3 instead of 4:5 and the QR card drops its URL line, so the page still fits without a scroll.
 */
export function LiveComponent({ page, width, compact = false }: { page: OnboardingPageKey; width: number; compact?: boolean }) {
  const { t } = useTranslation('auth');
  const vehicle = useTranslation('vehicle').t;
  const styles = useStyles();
  const sample = (key: string) => t(`onboarding.sample.${key}`);
  if (page === 'garage') {
    // DQ-1035: the 2.0 VehicleCard: 4:5 photo, the name in display.title (Archivo), the mini spec in hero numerals.
    return (
      <View style={[styles.card, { width }]} testID="ONB-01.live">
        <View testID="ONB-01.card">
          <Photo {...PHOTOS.e46} aspect={compact ? '4:3' : '4:5'}>
            <SampleBadges flags={{ is_sample: true }} tone="onPhoto" style={styles.cardBadges} />
          </Photo>
          <View style={styles.cardBody}>
            <DisplayTitle placement="card" layoutWidth={width - 2 * space[16]} testID="ONB-01.card.title">
              {sample('e46Title')}
            </DisplayTitle>
            <MiniSpec
              items={[
                { key: 'power', value: '343', unit: 'PS', label: sample('power') },
                { key: 'torque', value: '365', unit: 'Nm', label: sample('torque') },
                { key: 'year', value: '2004', label: sample('year') },
              ]}
              testID="ONB-01.card.spec"
            />
          </View>
        </View>
      </View>
    );
  }
  if (page === 'sheet') {
    // DQ-1023 / DQ-1042: one row of three numerals and one ModRow, so the page fits its window and the photo still reads.
    return (
      <View style={[styles.panel, { width }]} testID="ONB-02.live">
        <SampleBadge />
        <MiniSpec
          items={[
            { key: 'power', value: '500', unit: 'PS', label: sample('power') },
            { key: 'torque', value: '540', unit: 'Nm', label: sample('torque') },
            { key: 'year', value: '2002', label: sample('year') },
          ]}
          testID="ONB-02.spec"
        />
        <BuildSheet
          sections={[
            {
              key: 'engine',
              title: sample('engine'),
              icon: 'engine',
              count: 1,
              countLabel: vehicle('mods.count', { count: 1 }),
              mods: [{ key: 'turbo', icon: 'turbo', name: 'HKS GT-SS', brand: 'HKS', values: sample('boost'), status: sample('fitted') }],
            },
          ]}
          testID="ONB-02.sheet"
        />
      </View>
    );
  }
  return (
    <View style={[styles.panel, styles.qr]} testID="ONB-03.live">
      <SampleBadge />
      <QRDisplay svg={QR_SAMPLE_SVG} label={sample('qrLabel')} code="7H2K QXMB" url={compact ? undefined : 'speedclub.de/C/7H2KQXMB'} testID="ONB-03.qr" />
    </View>
  );
}
