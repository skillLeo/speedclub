import { valueSegments, type ValueSegment } from '@/lib/format';
import { createStyles } from '@/theme';

import { Text, type TextProps } from './Text';

export type ValueTextProps = Omit<TextProps, 'children'> & {
  /** "Serie → KW V3 · −35 mm" */
  values: string;
  /** False lets a value wrap at its own spaces, see `keepValuesTogether`. */
  wholeValues?: boolean;
  /** Segments cut by another rule (`diffSegments`), instead of `valueSegments(values, wholeValues)`. */
  segments?: readonly ValueSegment[];
};

const useStyles = createStyles(() => ({ tabular: { fontVariant: ['tabular-nums'] } }));

/**
 * §4 tnum is for numbers: a string of values with tabular figures only on the segments that are numeric. On the whole
 * string, Inter would also set each hyphen to the width of a digit, so "6-Kolben" reads "6 - Kolben".
 */
export function ValueText({ values, wholeValues = true, segments: given, style, ...text }: ValueTextProps) {
  const styles = useStyles();
  const segments = given ?? valueSegments(values, wholeValues);
  const [first] = segments;
  if (segments.length === 1 && first) {
    return (
      <Text {...text} style={[style, first.numeric ? styles.tabular : null]}>
        {first.text}
      </Text>
    );
  }
  return (
    <Text {...text} style={style}>
      {segments.map((segment, index) =>
        segment.numeric ? (
          // A nested Text resets to its variant, so it takes the same look as the outer one.
          <Text key={index} variant={text.variant} color={text.color} hyphenate={text.hyphenate} style={[style, styles.tabular]}>
            {segment.text}
          </Text>
        ) : (
          segment.text
        ),
      )}
    </Text>
  );
}
