import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { formatNumber } from '@/lib/format';
import { isWeb } from '@/lib/platform';
import { useFormat } from '@/lib/useFormat';
import { createStyles, space, useBreakpoint, useTheme } from '@/theme';
import { Chip } from '@/ui/Chip';
import { Text } from '@/ui/Text';
import { useImagePlaceholder } from '@/ui/imagePlaceholder';

import { StickerArt, svgOnCar } from '../components/StickerArt';
import {
  MOCKUPS,
  MOCKUP_ASPECT,
  mockupFor,
  mockupLayout,
  type MockupKey,
  type MockupLayout,
} from './mockups';
import { Parallax } from './Parallax';

export type PreviewMode = 'flat' | 'car' | 'ruler';

const useStyles = createStyles((t) => ({
  flat: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: t.space[24] },
  // DQ-M54R2-08: 8 more at the foot, so the caption's descenders never touch the dock at 200 %.
  car: {
    alignItems: 'center',
    flex: 1,
    gap: t.space[12],
    justifyContent: 'center',
    paddingBottom: t.space[20],
    paddingTop: t.space[12],
  },
  frame: { backgroundColor: t.color.media.ground, borderRadius: t.radius.md, overflow: 'hidden' },
  layer: { position: 'absolute' },
  loupe: {
    borderColor: t.color.onPhoto.border,
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    bottom: t.space[8],
    overflow: 'hidden',
    position: 'absolute',
    right: t.space[8],
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space[8], justifyContent: 'center' },
  ruler: { flex: 1 },
  rulerScroll: { flexGrow: 1, paddingBottom: t.space[16], paddingTop: t.space[12] },
  rulerContent: {
    alignItems: 'flex-start',
    gap: t.space[8],
    paddingBottom: t.space[16],
    paddingHorizontal: t.space[24],
    paddingTop: t.space[8],
  },
  rulerNote: { paddingHorizontal: t.space[24] },
  tickRow: { flexDirection: 'row' },
  rulerColumn: { flexDirection: 'column', gap: t.space[2] },
}));

/**
 * Points per millimetre for "Originalgröße": 1/160 in per dp on Android, 1/163 in per point on iOS phones, and a CSS pixel on the
 * web (1/96 in nominally; phone browsers draw it about as large as a native point). A screen is never calibrated, so the screen says
 * "ungefähr" and names the exact size next to it.
 */
export function pointsPerMm(os: string, web: boolean, phoneWidth: boolean): number {
  if (web) return phoneWidth ? 163 / 25.4 : 96 / 25.4;
  return os === 'android' ? 160 / 25.4 : 163 / 25.4;
}

type StageProps = {
  mode: PreviewMode;
  svg: string;
  widthMm: number;
  heightMm: number;
  material: 'transparent' | 'white_vinyl';
  label: string;
  /** The room the stage has. */
  width: number;
  height: number;
  mockup: MockupKey;
  onMockupChange: (key: MockupKey) => void;
  /** Full motion and the screen focused: the tilt parallax runs. */
  tiltActive: boolean;
  testID: string;
};

/** Flat: the sticker as large as the stage allows, on its surface, crossfading on a template switch. */
function FlatPreview({ svg, widthMm, heightMm, label, width, height, testID }: StageProps) {
  const styles = useStyles();
  const room = { width: Math.max(0, width - 2 * space[24]), height: Math.max(0, height - 2 * space[24]) };
  const drawn =
    widthMm > 0 && heightMm > 0 ? Math.min(room.width, (room.height * widthMm) / heightMm) : room.width;
  return (
    <View style={styles.flat} testID={`${testID}.flat`}>
      <StickerArt
        svg={svg}
        width={drawn}
        widthMm={widthMm}
        heightMm={heightMm}
        label={label}
        crossfade
        testID={`${testID}.art`}
      />
    </View>
  );
}

/** The loupe's share of the frame and its largest enlargement. */
const LOUPE_SHARE = 0.42;
const LOUPE_ZOOM = 3;

/**
 * The loupe in the frame's bottom-right corner: the same photo and sticker, enlarged around the sticker's centre (at most 3×, and never
 * larger than the loupe minus a margin).
 */
export function loupeLayout(layout: MockupLayout, frameWidth: number) {
  const size = Math.round(frameWidth * LOUPE_SHARE);
  const { sticker, photo } = layout;
  const room = size - 2 * space[8];
  const zoom =
    sticker.width > 0 && sticker.height > 0
      ? Math.min(LOUPE_ZOOM, room / sticker.width, room / sticker.height)
      : 1;
  const centreX = sticker.left + sticker.width / 2;
  const centreY = sticker.top + sticker.height / 2;
  return {
    size,
    photo: {
      width: photo.width * zoom,
      height: photo.height * zoom,
      left: size / 2 - (centreX - photo.left) * zoom,
      top: size / 2 - (centreY - photo.top) * zoom,
    },
    sticker: {
      width: sticker.width * zoom,
      height: sticker.height * zoom,
      left: size / 2 - (sticker.width * zoom) / 2,
      top: size / 2 - (sticker.height * zoom) / 2,
    },
  };
}

/** "am Auto": the film on a real photo at its real size, with a subtle tilt parallax on devices (10 §2.3). */
function CarPreview(props: StageProps) {
  const {
    svg,
    widthMm,
    heightMm,
    material,
    label,
    width,
    height,
    mockup,
    onMockupChange,
    tiltActive,
    testID,
  } = props;
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const entry = mockupFor(mockup);
  // Chips, the caption line and their gaps under the frame.
  const chipsRoom = space[32] + space[12] + space[16] + space[8];
  const frameWidth = Math.max(
    0,
    Math.min(width - 2 * space[24], (height - chipsRoom - 2 * space[12]) * MOCKUP_ASPECT),
  );
  const layout = mockupLayout(entry, frameWidth, { widthMm, heightMm }, space[8]);
  const loupe = loupeLayout(layout, frameWidth);
  const placeholder = useImagePlaceholder(null, 'cover', entry.photo.thumbhash);
  return (
    <View style={styles.car} testID={`${testID}.car`}>
      <View style={[styles.frame, { width: frameWidth, height: frameWidth / MOCKUP_ASPECT }]}>
        <Parallax active={tiltActive} style={[styles.layer, layout.photo]}>
          <Image
            source={entry.photo.source}
            {...placeholder}
            contentFit="cover"
            style={{
              width: layout.photo.width,
              height: layout.photo.height,
              aspectRatio: entry.width / entry.height,
            }}
            accessible={false}
            alt=""
            testID={`${testID}.car.photo`}
          />
        </Parallax>
        <View style={[styles.layer, layout.sticker]}>
          <StickerArt
            svg={svgOnCar(svg, material)}
            width={layout.sticker.width}
            widthMm={widthMm}
            heightMm={heightMm}
            label={t('designer.preview.carLabel', {
              sticker: label,
              photo: t(`designer.preview.photos.${entry.key}`),
            })}
            testID={`${testID}.car.art`}
          />
        </View>
        {/* DQ-M54-05: at real size a sticker is small on a car; the loupe shows it enlarged, the frame keeps the honest scale. */}
        <View
          style={[styles.loupe, { width: loupe.size, height: loupe.size }]}
          aria-hidden
          testID={`${testID}.car.loupe`}
        >
          <Image
            source={entry.photo.source}
            {...placeholder}
            contentFit="cover"
            style={[styles.layer, loupe.photo, { aspectRatio: entry.width / entry.height }]}
            accessible={false}
            alt=""
          />
          <View style={[styles.layer, loupe.sticker]}>
            <StickerArt
              svg={svgOnCar(svg, material)}
              width={loupe.sticker.width}
              widthMm={widthMm}
              heightMm={heightMm}
              label=""
            />
          </View>
        </View>
      </View>
      <View style={styles.chips} role="radiogroup" aria-label={t('designer.preview.photoGroup')}>
        {MOCKUPS.map((item) => (
          <Chip
            key={item.key}
            label={t(`designer.preview.photos.${item.key}`)}
            selected={item.key === mockup}
            selectionRole="radio"
            onPress={() => onMockupChange(item.key)}
            testID={`${testID}.photo.${item.key}`}
          />
        ))}
      </View>
      <Text variant="caption" color="text.secondary" testID={`${testID}.car.caption`}>
        {t('designer.preview.carCaption')}
      </Text>
    </View>
  );
}

/** "Originalgröße": the sticker at about its real size with a centimetre ruler; wide stickers scroll sideways. */
function RulerPreview({ svg, widthMm, heightMm, label, width, testID }: StageProps) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const theme = useTheme();
  const format = useFormat();
  const { kind } = useBreakpoint();
  const perMm = pointsPerMm(Platform.OS, isWeb, kind === 'phone');
  const drawnWidth = widthMm * perMm;
  const tickRoom = space[24];
  const centimetres = Math.floor(widthMm / 10);
  const mm = (value: number) => formatNumber(value, format.locale, { maxFractionDigits: 0 });
  return (
    // Real millimetres rarely fit a phone (156 mm is wider than most screens): the sticker scrolls both ways.
    // DQ-M54-03 (375 × 667): the note and the ruler come first, along the sticker's top edge, so a short stage still shows them; the
    // sticker follows and may run past the stage's foot.
    <ScrollView
      style={styles.ruler}
      contentContainerStyle={styles.rulerScroll}
      nestedScrollEnabled
      testID={`${testID}.ruler`}
    >
      <Text variant="callout" color="text.secondary" style={styles.rulerNote} testID={`${testID}.ruler.note`}>
        {t('designer.preview.rulerNote', { width: mm(widthMm), height: mm(heightMm) })}
        {drawnWidth > width - 2 * space[24] ? ` ${t('designer.preview.rulerScroll')}` : ''}
      </Text>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        contentContainerStyle={styles.rulerContent}
      >
        {/* One column, so the ruler starts at the sticker's left edge (a horizontal scroller lays children in a row). */}
        <View style={styles.rulerColumn}>
          <View aria-hidden testID={`${testID}.ruler.scale`}>
            <Text variant="caption" color="text.tertiary">
              {t('designer.preview.rulerUnit')}
            </Text>
            <View style={styles.tickRow}>
              {Array.from({ length: centimetres + 1 }, (_, cm) => (
                <View key={cm} style={{ width: 10 * perMm }}>
                  <Text variant="caption" numeric color="text.tertiary">
                    {mm(cm)}
                  </Text>
                </View>
              ))}
            </View>
            <Svg width={drawnWidth} height={tickRoom}>
              <Line
                x1={0}
                y1={tickRoom - 0.5}
                x2={drawnWidth}
                y2={tickRoom - 0.5}
                stroke={theme.color.text.secondary}
                strokeWidth={1}
              />
              {Array.from({ length: Math.floor(widthMm / 5) + 1 }, (_, index) => {
                const x = Math.min(drawnWidth - 0.5, index * 5 * perMm + 0.5);
                // Every 5 mm a short tick, every centimetre a longer one, every 5 cm the longest, all pointing at the sticker.
                const reach = index % 10 === 0 ? tickRoom : index % 2 === 0 ? space[12] : space[8];
                return (
                  <Line
                    key={index}
                    x1={x}
                    y1={tickRoom - reach}
                    x2={x}
                    y2={tickRoom}
                    stroke={theme.color.text.secondary}
                    strokeWidth={1}
                  />
                );
              })}
            </Svg>
          </View>
          <StickerArt
            svg={svg}
            width={drawnWidth}
            widthMm={widthMm}
            heightMm={heightMm}
            label={label}
            testID={`${testID}.ruler.art`}
          />
        </View>
      </ScrollView>
    </ScrollView>
  );
}

/** The designer's large preview in one of its three modes (10 §2.3). */
export function PreviewStage(props: StageProps) {
  if (props.mode === 'car') return <CarPreview {...props} />;
  if (props.mode === 'ruler') return <RulerPreview {...props} />;
  return <FlatPreview {...props} />;
}
