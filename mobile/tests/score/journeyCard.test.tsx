/**
 * ADR-518: the Build Journey card is a story card, a fixed composition. It lays out at its design width with its type capped at
 * 1.3 (a), the sheet's preview scales it as a whole (b), and its root carries the story-card marker for the DOM audit (c).
 */
import { screen } from '@testing-library/react-native';
import { StyleSheet, useWindowDimensions, type TextStyle, type ViewStyle } from 'react-native';

import { parseBuildScore, type BuildScore } from '@/api/queries/buildScore';
import {
  JOURNEY_CARD_FONT_SCALE_CAP,
  JOURNEY_CARD_HEIGHT,
  JOURNEY_CARD_WIDTH,
  footerLabelFits,
  JourneyCard,
  journeyCardWidth,
  JourneyPreview,
  journeyPreviewScale,
} from '@/features/score/components/JourneyCard';
import { hydrateThemePreference, layout, size, typography } from '@/theme';

import { renderWithConfig as renderUi } from '../ui/configHelpers';
import { R34 } from '../vehicle/fixtures';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn(() => jest.fn()) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: jest.fn(() => ({ width: 393, height: 852, scale: 3, fontScale: 1 })),
}));

const dimensions = useWindowDimensions as jest.Mock;
const SCORE = parseBuildScore({
  total: 642,
  stage: 4,
  parts: { completeness: { points: 220, max: 300 }, documentation: { points: 200, max: 300 }, community: { points: 132, max: 250 }, journey: { points: 90, max: 150 } },
  ranks: [],
  computed_at: '2026-11-14T08:30:00Z',
  previous_total: 617,
  formula_version: '1',
}) as BuildScore;
/** The round-2 preview width at 200 % (VEH-01-journey fs2): the card used to reflow to it. */
const NARROW = 213;

const box = (testID: string): ViewStyle => StyleSheet.flatten(screen.getByTestId(testID).props.style as ViewStyle) ?? {};

async function renderPreview(fontScale: number, width = NARROW) {
  dimensions.mockReturnValue({ width: 393, height: 852, scale: 3, fontScale });
  await renderUi(
    <JourneyPreview width={width} label="Journey-Karte von Nissan Skyline GT-R R34" testID="p">
      <JourneyCard vehicle={R34} score={SCORE} testID="c" />
    </JourneyPreview>,
  );
}

beforeAll(hydrateThemePreference);

describe('Journey card as a fixed composition (ADR-518)', () => {
  it('has one 9:16 design size of five eighths of the feed column', () => {
    expect(JOURNEY_CARD_WIDTH).toBe((layout.feedColumn * 5) / 8);
    expect(JOURNEY_CARD_WIDTH / JOURNEY_CARD_HEIGHT).toBeCloseTo(9 / 16, 6);
    expect(JOURNEY_CARD_FONT_SCALE_CAP).toBe(1.3);
  });

  it('scales down to the preview, never up past the design size', () => {
    expect(journeyPreviewScale(NARROW)).toBeCloseTo(NARROW / JOURNEY_CARD_WIDTH);
    expect(journeyPreviewScale(JOURNEY_CARD_WIDTH)).toBe(1);
    expect(journeyPreviewScale(JOURNEY_CARD_WIDTH * 2)).toBe(1);
    expect(journeyPreviewScale(0)).toBe(0);
  });

  it('sizes the preview to the room above the footer, at most the design width, and never past that room (DQ-P5G-23)', () => {
    const roomy = journeyCardWidth({ column: 600, windowHeight: 2000, titleLine: 28, hint: 44, footer: 140, safeBottom: 0 });
    expect(roomy).toBe(JOURNEY_CARD_WIDTH);
    const narrowColumn = journeyCardWidth({ column: 300, windowHeight: 2000, titleLine: 28, hint: 44, footer: 140, safeBottom: 0 });
    expect(narrowColumn).toBe(300);
    // 393 × 852 at 200 % on the member web, as Sheet lays it out: panel round(852 × 0.9) = 767; header 8 + grabber 4 + 12 + the
    // title's 56 + 8; the hint's five 40 lines, its 16 gap and the body's 16; the footer panel 12 + two one-line L buttons (62 + 8 +
    // 62) + 12. The whole 9:16 card stands in what is left, so nothing of it sits under the footer.
    const panel = Math.round(852 * size.sheetMaxHeightRatio);
    const header = 8 + size.grabber.height + 12 + 56 + 8;
    const footer = 12 + 132 + 12;
    const fs2 = journeyCardWidth({ column: 353, windowHeight: 852, titleLine: 56, hint: 200, footer: 132, safeBottom: 0 });
    expect(fs2).toBeGreaterThan(0);
    expect(header + 200 + 16 + fs2 / (9 / 16) + 16 + footer).toBeLessThanOrEqual(panel);
    expect(header + 200 + 16 + (fs2 + 1) / (9 / 16) + 16 + footer).toBeGreaterThan(panel);
    // A sheet with less room gets a smaller card, never one that runs under the footer (the old 160 floor did, DQ-P5G-23).
    const short = journeyCardWidth({ column: 353, windowHeight: 852, titleLine: 56, hint: 200, footer: 260, safeBottom: 34 });
    expect(short).toBeLessThan(layout.feedColumn / 4);
    expect(header + 200 + 32 + short / (9 / 16) + 12 + 260 + 34 + 12).toBeLessThanOrEqual(panel);
  });

  it('keeps a footer label on one line beside its icon, else takes the short form (DQ-P5G-23)', () => {
    expect(footerLabelFits('Story herunterladen', 353, 1)).toBe(true);
    expect(footerLabelFits('Quadrat herunterladen', 335, 1)).toBe(true);
    expect(footerLabelFits('Story herunterladen', 353, 2)).toBe(false);
    expect(footerLabelFits('Quadrat', 353, 2)).toBe(true);
    expect(footerLabelFits('Square', 353, 2)).toBe(true);
  });

  it('lays the card out at its design width inside a clipped box of the preview size, scaled from the top-left corner', async () => {
    await renderPreview(1);
    const card = box('c');
    expect(card.width).toBe(JOURNEY_CARD_WIDTH);
    expect(card.height).toBeCloseTo(JOURNEY_CARD_HEIGHT);
    const preview = box('p');
    expect(preview.width).toBe(NARROW);
    expect(preview.height).toBeCloseTo((NARROW * 16) / 9);
    expect(preview.overflow).toBe('hidden');
    const scaled = box('p.scaled');
    expect(scaled.transform).toEqual([{ scale: NARROW / JOURNEY_CARD_WIDTH }]);
    expect(scaled.transformOrigin).toBe('top left');
    expect(scaled.position).toBe('absolute');
    // The card keeps its parts' test IDs.
    expect(screen.getByTestId('c.title')).toBeTruthy();
    expect(screen.getByTestId('c.gauge')).toBeTruthy();
  });

  it('is one image to assistive technology, labelled by the preview', async () => {
    await renderPreview(1);
    const preview = screen.getByTestId('p');
    expect(preview.props.role).toBe('img');
    expect(preview.props['aria-label']).toBe('Journey-Karte von Nissan Skyline GT-R R34');
  });

  it('marks the card root (the view-shot target) as a story card for the DOM audit', async () => {
    await renderPreview(1);
    const root = screen.getByTestId('c');
    expect(root.props.dataSet).toEqual({ qaExempt: 'story-card' });
    expect(root.props.collapsable).toBe(false);
  });

  it('caps its type at 1.3 at a 200 % system font, the OS scaling off', async () => {
    await renderPreview(2);
    const caption = screen.getByText(`${R34.updates_count} Einträge im Verlauf`);
    const style: TextStyle = StyleSheet.flatten(caption.props.style as TextStyle) ?? {};
    expect(caption.props.allowFontScaling).toBe(false);
    expect(style.fontSize).toBeCloseTo(typography.caption.fontSize * 1.3);
    expect(style.lineHeight).toBeCloseTo(typography.caption.lineHeight * 1.3);
    // The card itself keeps its design size at any font scale.
    expect(box('c').width).toBe(JOURNEY_CARD_WIDTH);
  });
});
