/**
 * React Native Web renders `dataSet` as data-* attributes; native ignores it. The QA harness reads
 * `qaHitWrapper` and `qaExempt` (web/tests/e2e/README.md). No other use is intended.
 */
import 'react-native';

type QaDataSet = {
  qaHitWrapper?: 'true';
  /**
   * photo, qr, safe-area or hairline; space-separated. brand-position (AUTH-02's logo slot) and fixed-glyph (an avatar's
   * initials) only where ADR-149 and ADR-150 put them. Meanings: web/tests/e2e/support/dom-audit.mjs.
   */
  qaExempt?: string;
};

declare module 'react-native' {
  interface ViewProps {
    dataSet?: QaDataSet;
  }
  interface TextProps {
    dataSet?: QaDataSet;
  }
}
