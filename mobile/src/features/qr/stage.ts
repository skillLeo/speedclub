import { size, space } from '@/theme';

/**
 * ADR-458 (DQ-1053): below 768 the QR card is narrower than the column (296 at 393), so both side bands of the stage carry the
 * member's car. The card is the scannable minimum's frame plus 48 of code: the QR stays 248 (≥ 240) at its §8 card padding of 24.
 */
export const QR_CARD_COMPACT = size.qrMinOnScreen + 4 * space[24];

/** The card's width on a phone: the column, never wider than the compact card. */
export function compactCardWidth(column: number): number {
  return Math.min(column, QR_CARD_COMPACT);
}
