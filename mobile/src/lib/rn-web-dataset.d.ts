/**
 * React Native Web renders `dataSet` as data-* attributes; native ignores it. The QA harness reads
 * `qaHitWrapper` and `qaExempt` (web/tests/e2e/README.md); `pressTone` marks the decorative SM7 tone layer (PressableScale), which
 * carries no test ID. No other use is intended.
 */
import 'react-native';

type QaDataSet = {
  qaHitWrapper?: 'true';
  /**
   * photo, qr, safe-area or hairline; space-separated. brand-position (AUTH-02's logo slot) and fixed-glyph (an avatar's
   * initials) only where ADR-149 and ADR-150 put them. Meanings: web/tests/e2e/support/dom-audit.mjs.
   */
  qaExempt?: string;
  /** The SM7 press tone layer: aria-hidden and without a test ID, so test-ID prefixes list controls only (PRESS_TONE_DATASET). */
  pressTone?: 'layer';
  /**
   * A field's hidden measuring copy: `mirror` (web: the multiline text that sizes the textarea), `line` (native: one line of the
   * input role). Marked instead of carrying a test ID, which would extend the control's prefix.
   */
  qaMeasure?: 'mirror' | 'line';
};

declare module 'react-native' {
  interface ViewProps {
    dataSet?: QaDataSet;
  }
  interface TextProps {
    dataSet?: QaDataSet;
  }
}
