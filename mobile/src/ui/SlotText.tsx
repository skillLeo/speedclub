import type { ReactNode } from 'react';
import { Platform } from 'react-native';

import { Text, type TextProps } from './Text';

/** Private-use characters (U+E000, U+E001) around a slot's name: no translation can contain one. */
const SLOT_START = '';
const SLOT_END = '';
const SLOT = new RegExp(`${SLOT_START}([^${SLOT_END}]*)${SLOT_END}`);

/**
 * A placeholder for a value that SlotText sets apart: pass it to `t()` in place of the value (`t('published.body', { vehicle:
 * slot('vehicle') })`) and the value itself in `slots`.
 */
export function slot(name: string): string {
  return `${SLOT_START}${name}${SLOT_END}`;
}

export type SlotTextProps = Omit<TextProps, 'children'> & {
  /** The translated line, with `slot(name)` where a value goes. */
  text: string;
  /** The value of each slot, already made breakable (`nameInText`, `identifierText`, `handleText`). */
  slots?: Readonly<Record<string, string>>;
  /** Names in the copy itself that never hyphenate (PRODUCT_NAMES). */
  keep?: readonly string[];
};

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * DQ-926, DQ-927: a line of running copy with names and identifiers set apart. Each value, and each `keep` name in the copy,
 * is a nested Text in the same role with `hyphenate={false}`, so "Nissan Skyline GT-R R34", "lukas.sc@speed-club.test" or
 * "Google Authenticator" read as on file.
 *
 * Web: the spans carry `hyphens: none` each, and the copy around them keeps hyphenation (DQ-181) and pretty wrapping.
 * Android (SF-R4-1): hyphenation is a paragraph attribute there (`android_hyphenationFrequency` of the outer Text; a nested
 * Text is a virtual span that cannot set it), so a line with at least one span does not hyphenate at all: a value never
 * splits, at the cost of the copy's own hyphenation in that one line. iOS never hyphenates a Text.
 */
export function SlotText({ text, slots = {}, keep = [], hyphenate, ...rest }: SlotTextProps) {
  const whole = (value: string, key: string): ReactNode => (
    // A nested Text resets to its variant, so it takes the same look as the outer one.
    <Text key={key} variant={rest.variant} color={rest.color} numeric={rest.numeric} fontScaleCap={rest.fontScaleCap} hyphenate={false}>
      {value}
    </Text>
  );
  const kept = keep.length > 0 ? new RegExp(`(${keep.map(escape).join('|')})`) : null;
  const copy = (part: string, key: string): ReactNode[] => {
    if (!kept) return part ? [part] : [];
    return part
      .split(kept)
      .map((piece, index) => (index % 2 === 1 ? whole(piece, `${key}.${index}`) : piece))
      .filter((piece) => piece !== '');
  };
  const children = text.split(SLOT).flatMap((part, index) => (index % 2 === 1 ? [whole(slots[part] ?? '', `slot.${index}`)] : copy(part, `copy.${index}`)));
  const hasSpan = children.some((child) => typeof child !== 'string');
  const paragraphHyphenate = Platform.OS === 'android' && hasSpan ? false : hyphenate;
  return (
    <Text {...rest} hyphenate={paragraphHyphenate}>
      {children}
    </Text>
  );
}
