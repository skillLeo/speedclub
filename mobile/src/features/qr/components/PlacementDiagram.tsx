import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import Svg, { Circle, Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { isWeb } from '@/lib/platform';
import { createStyles, fonts, resolveColor, size, typography, useTheme, type ColorToken } from '@/theme';
import { Text } from '@/ui';

/** How a place on the car reads in QR-03. */
export type PlacementTone = 'ok' | 'caution' | 'avoid';

export const TONE_COLOR: Readonly<Record<PlacementTone, ColorToken>> = {
  ok: 'status.success',
  caution: 'status.warning',
  avoid: 'status.danger',
};

/** The four places of 08_LEGAL_COMPLIANCE §7, in the order of its list. */
export const PLACEMENT_ZONES = [
  { key: 'body', number: 1, tone: 'ok' },
  { key: 'rearWindow', number: 2, tone: 'caution' },
  { key: 'frontSide', number: 3, tone: 'avoid' },
  { key: 'windscreen', number: 4, tone: 'avoid' },
] as const satisfies readonly { key: string; number: number; tone: PlacementTone }[];

/** Drawing units: a car seen from above, front to the left, 320 × 154. */
const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 154;
const MARKER_RADIUS = 11;
const MARKER_TEXT_SIZE = 12;
/** Half the marker text height, to centre the figure on the circle. */
const MARKER_BASELINE = 4;
const STROKE_ZONE = 2;
const STROKE_BODY = 1.5;
const STROKE_DETAIL = 1;

const useStyles = createStyles((t) => ({
  card: { backgroundColor: t.color.bg.surface, borderRadius: t.radius.md, gap: t.space[8], padding: t.space[16] },
  drawing: { aspectRatio: VIEW_WIDTH / VIEW_HEIGHT, width: '100%' },
  ends: { flexDirection: 'row', justifyContent: 'space-between' },
}));

/**
 * QR-03: the car from above, drawn from tokens. The four places of the guide are outlined in their tone and numbered like the
 * list below it. Hairline detail in border tokens, zones on bg.raised, no stock art and no photo.
 */
export function PlacementDiagram({ testID }: { testID?: string }) {
  const { t } = useTranslation('qr');
  const styles = useStyles();
  const theme = useTheme();
  const c = (token: ColorToken) => resolveColor(theme, token);
  const outline = c('border.strong');
  const detail = c('border.default');
  const glass = c('bg.raised');
  const body = c('bg.canvas');
  const tone = (value: PlacementTone) => c(TONE_COLOR[value]);
  const family = isWeb ? `${typography.labelS.fontFamily}, ${fonts.ui.css}` : typography.labelS.fontFamily;

  const marker = (x: number, y: number, number: number, value: PlacementTone) => (
    <>
      <Circle cx={x} cy={y} r={MARKER_RADIUS} fill={c('bg.surface')} stroke={tone(value)} strokeWidth={STROKE_BODY} />
      <SvgText
        x={x}
        y={y + MARKER_BASELINE}
        fill={tone(value)}
        fontSize={MARKER_TEXT_SIZE}
        fontFamily={family}
        textAnchor="middle"
      >
        {String(number)}
      </SvgText>
    </>
  );

  return (
    <View style={styles.card} testID={testID}>
      <View accessible role="img" aria-label={t('placement.diagramLabel')} style={styles.drawing}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
          {/* Wheels, just outside the body */}
          <Rect x={46} y={30} width={36} height={8} rx={2} fill={outline} />
          <Rect x={46} y={138} width={36} height={8} rx={2} fill={outline} />
          <Rect x={232} y={30} width={36} height={8} rx={2} fill={outline} />
          <Rect x={232} y={138} width={36} height={8} rx={2} fill={outline} />
          {/* Mirrors at the A-pillars: two of them, as rule 2 asks */}
          <Rect x={100} y={26} width={14} height={12} rx={4} fill={body} stroke={outline} strokeWidth={STROKE_DETAIL} />
          <Rect x={100} y={138} width={14} height={12} rx={4} fill={body} stroke={outline} strokeWidth={STROKE_DETAIL} />
          {/* Body */}
          <Rect x={16} y={36} width={288} height={104} rx={30} fill={body} stroke={outline} strokeWidth={STROKE_BODY} />
          {/* Bonnet and roof, in detail lines */}
          <Rect x={30} y={52} width={54} height={72} rx={10} fill="none" stroke={detail} strokeWidth={STROKE_DETAIL} />
          <Rect x={130} y={46} width={108} height={84} rx={6} fill={glass} stroke={detail} strokeWidth={STROKE_DETAIL} />
          {/* Rear side windows: no rule of their own */}
          <Rect x={188} y={38} width={50} height={6} rx={2} fill={glass} stroke={detail} strokeWidth={STROKE_DETAIL} />
          <Rect x={188} y={132} width={50} height={6} rx={2} fill={glass} stroke={detail} strokeWidth={STROKE_DETAIL} />
          {/* 4 Windscreen */}
          <Polygon points="90,54 128,44 128,132 90,122" fill={glass} stroke={tone('avoid')} strokeWidth={STROKE_ZONE} strokeLinejoin="round" />
          {/* 3 Front side windows, both sides */}
          <Rect x={132} y={38} width={52} height={6} rx={2} fill={glass} stroke={tone('avoid')} strokeWidth={STROKE_ZONE} />
          <Rect x={132} y={132} width={52} height={6} rx={2} fill={glass} stroke={tone('avoid')} strokeWidth={STROKE_ZONE} />
          {/* 2 Rear window, with a small sticker in its lower corner */}
          <Polygon points="242,44 268,54 268,122 242,132" fill={glass} stroke={tone('caution')} strokeWidth={STROKE_ZONE} strokeLinejoin="round" />
          <Rect x={255} y={114} width={7} height={7} rx={1} fill={tone('caution')} />
          {/* 1 Boot lid and bumper */}
          <Rect x={274} y={52} width={22} height={72} rx={6} fill="none" stroke={tone('ok')} strokeWidth={STROKE_ZONE} />
          <Rect x={281} y={98} width={9} height={9} rx={1} fill={tone('ok')} />
          {/* Markers, numbered like the list */}
          {marker(285, 74, 1, 'ok')}
          {marker(255, 88, 2, 'caution')}
          <Line x1={158} y1={18 + MARKER_RADIUS} x2={158} y2={38} stroke={tone('avoid')} strokeWidth={STROKE_DETAIL} />
          {marker(158, 18, 3, 'avoid')}
          {marker(109, 88, 4, 'avoid')}
        </Svg>
      </View>
      <View style={styles.ends} aria-hidden>
        <Text variant="supporting" color="text.secondary">
          {t('placement.front')}
        </Text>
        <Text variant="supporting" color="text.secondary">
          {t('placement.rear')}
        </Text>
      </View>
    </View>
  );
}

/** The numbered marker of a rule row, the same as in the drawing. */
export function PlacementMarker({ number, tone, label }: { number: number; tone: PlacementTone; label: string }) {
  const theme = useTheme();
  const markerStyles = useMarkerStyles();
  return (
    <View
      accessible
      role="img"
      aria-label={label}
      style={[markerStyles.marker, { borderColor: resolveColor(theme, TONE_COLOR[tone]) }]}
    >
      <Text variant="labelS" color={TONE_COLOR[tone]} hyphenate={false} selectable={false}>
        {String(number)}
      </Text>
    </View>
  );
}

const useMarkerStyles = createStyles((t) => ({
  // 24 at 100 %; it grows with the figure at a large font instead of clipping it.
  marker: {
    alignItems: 'center',
    backgroundColor: t.color.bg.surface,
    borderRadius: t.radius.full,
    borderWidth: t.size.border.inputFocus,
    justifyContent: 'center',
    minHeight: size.icon.l,
    minWidth: size.icon.l,
    paddingHorizontal: t.space[4],
  },
}));
