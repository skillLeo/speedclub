import type { ColorToken, TypeVariant } from '@/theme';
import { Text } from '@/ui/Text';

/** One part of a fact line: `numeric` sets tabular figures on that part alone. */
export type Fact = { text: string; numeric?: boolean };

/** The parts that are there, in order ("Hamburg", "12 Mitglieder"). */
export function facts(parts: readonly (Fact | null | undefined | false | '')[]): Fact[] {
  return parts.filter((part): part is Fact => Boolean(part && part.text));
}

/**
 * "Nordrhein-Westfalen · 12 Mitglieder" (R4DQ-45): tabular figures only on the parts that carry a number. Set on a whole line,
 * Inter's `tnum` also gives the hyphen of a name a figure's width, and "Nordrhein-Westfalen" shows space around it.
 */
export function FactLine({
  parts,
  variant,
  color,
  hyphenate,
  testID,
}: {
  parts: readonly Fact[];
  variant: TypeVariant;
  color: ColorToken;
  hyphenate?: boolean;
  testID?: string;
}) {
  return (
    <Text variant={variant} color={color} hyphenate={hyphenate} testID={testID}>
      {parts.map((part, index) => {
        const separator = index > 0 ? ' · ' : '';
        return part.numeric ? (
          // A nested Text resets to its variant, so it takes the same look as the line.
          <Text key={index} variant={variant} color={color} numeric hyphenate={hyphenate}>
            {`${separator}${part.text}`}
          </Text>
        ) : (
          `${separator}${part.text}`
        );
      })}
    </Text>
  );
}
