import { Link, type Href } from 'expo-router';
import { Fragment } from 'react';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { PixelRatio, StyleSheet, View, type TextStyle } from 'react-native';

import { haptics } from '@/lib/haptics';
import { isWeb } from '@/lib/platform';
import { createStyles, size, typography, useTheme } from '@/theme';
import { Checkbox, Icon, Text } from '@/ui';
import { useFocusRing } from '@/ui/useFocusRing';

import { fieldMessage } from '../forms';

/** DQ-150: a name that wraps inside the link keeps its padding, margin and round corners on each of its lines. */
const BOX_PER_LINE = (isWeb ? { boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' } : {}) as TextStyle;

const useStyles = createStyles((t) => ({
  // The error stands 12 under the label, where a 44 row put it.
  consent: { gap: t.space[12] },
  consentRow: { alignItems: 'flex-start', columnGap: t.space[12], flexDirection: 'row' },
  box: { width: t.size.checkbox },
  // 44 × 44, centred on the box and on the label's first line. It ends 1 before the label (22 + 11 against 22 + 12).
  target: { left: (t.size.checkbox - t.size.touchMin) / 2, position: 'absolute' },
  label: { flex: 1, minWidth: 0 },
  // §5: underlined, so it reads as a link without colour.
  link: { textDecorationLine: 'underline' },
  // DQ-148: a link inside a sentence draws its ring in the word gap, not across the neighbouring letters (see SignUpScreen history).
  inlineRing: {
    borderRadius: t.radius.xs,
    marginHorizontal: -t.space[2],
    outlineOffset: -t.size.border.focusRing / 2,
    paddingHorizontal: t.space[2],
    ...BOX_PER_LINE,
  },
  // DQ-998: the error belongs to the sentence, so it starts on the label's edge (box + the row's gap), glyph inline before it.
  error: { alignItems: 'flex-start', flexDirection: 'row', gap: t.space[4], paddingBottom: t.space[4], paddingLeft: t.size.checkbox + t.space[12] },
  errorIcon: { paddingTop: t.space[2] },
  errorText: { flexShrink: 1 },
}));

const DOC_LINK = /^([\s\S]*?)<doc>([\s\S]+?)<\/doc>([\s\S]*)$/;

/**
 * DQ-142: the document's name is a link inside its consent's sentence ("Ich akzeptiere die AGB."), so it cannot be read
 * as part of the next row. Returns the sentence around the first marked name, or null for a sentence without one.
 */
export function splitDocLink(sentence: string): { before: string; link: string; after: string } | null {
  const match = DOC_LINK.exec(sentence);
  if (!match) return null;
  return { before: match[1] ?? '', link: match[2] ?? '', after: match[3] ?? '' };
}

/** The sentence as the checkbox's name: the whole of it, without the marks. */
export function plainSentence(sentence: string): string {
  return sentence.replace(/<\/?doc>/g, '');
}

/** Punctuation that closes the document's name, as the full stop in "die AGB.". */
const CLOSING_PUNCTUATION = /^[.,;:!?)\]«»“”"'’]+/u;

/**
 * DQ-148: the punctuation right after the link, and the rest. Nothing separates it from the name, so a ring around the
 * name alone would cross it; it stands inside the link's focus box instead.
 */
export function splitClosingPunctuation(text: string): { closing: string; rest: string } {
  const closing = CLOSING_PUNCTUATION.exec(text)?.[0] ?? '';
  return { closing, rest: text.slice(closing.length) };
}

export type SentencePart = { kind: 'text'; text: string } | { kind: 'link'; text: string; closing: string; index: number };

/** AUTH-09b names two documents in one sentence: every `<doc>…</doc>` becomes a link, in order. */
export function sentenceParts(sentence: string): SentencePart[] {
  const parts: SentencePart[] = [];
  let rest = sentence;
  let index = 0;
  for (let split = splitDocLink(rest); split; split = splitDocLink(rest)) {
    if (split.before) parts.push({ kind: 'text', text: split.before });
    const after = splitClosingPunctuation(split.after);
    parts.push({ kind: 'link', text: split.link, closing: after.closing, index });
    index += 1;
    rest = after.rest;
  }
  if (rest) parts.push({ kind: 'text', text: rest });
  return parts;
}

/**
 * The document link: a real link on web (a new tab with the keyboard or a middle click), the token focus ring. Only the
 * name is underlined; `closing` sits inside the ring, after it, and stays out of the link's name.
 */
function DocLink({ href, label, closing, testID }: { href: Href; label: string; closing: string; testID: string }) {
  const styles = useStyles();
  const focus = useFocusRing();
  // Web: the click must not reach the sentence around it, which ticks the box.
  const keepToLink = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <Link href={href} push asChild onPress={keepToLink}>
      <Text
        variant="body"
        role="link"
        aria-label={label}
        // One object: Link's Slot merges the child's style by spreading it, which would turn an array into numbered keys.
        style={StyleSheet.flatten([focus.ringStyle, styles.inlineRing])}
        // tabIndex: Safari leaves a plain link out of the Tab order, unlike the app's other links, which are tab stops.
        {...(isWeb ? ({ tabIndex: 0, onFocus: focus.onFocus, onBlur: focus.onBlur } as object) : {})}
        testID={testID}
      >
        <Text variant="body" style={styles.link}>
          {label}
        </Text>
        {closing}
      </Text>
    </Link>
  );
}

export type ConsentCheckProps<T extends FieldValues> = {
  control: Control<T>;
  name: Path<T>;
  /** The sentence; each document's name in it is marked `<doc>…</doc>`. */
  label: string;
  /** The documents the marked names open, in their order. */
  hrefs?: readonly Href[];
  /** `<routeId>.<name>` for the box, `.label`, `.read{n}` and `.error`. */
  routeId: string;
};

/**
 * One consent: the box in its 44 target, and the sentence beside it, which ticks the box too. The links to documents sit
 * in the sentence, beside the checkbox and not inside it, so they never tick the box (WCAG 2.5.8 inline exception). The
 * checkbox is named by the whole sentence; the sentence of a consent without a link is the same text, so it is hidden.
 */
export function ConsentCheck<T extends FieldValues>({ control, name, label, hrefs = [], routeId }: ConsentCheckProps<T>) {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const theme = useTheme();
  const parts = hrefs.length > 0 ? sentenceParts(label) : null;
  const linked = parts?.some((part) => part.kind === 'link') ?? false;
  const sentence = plainSentence(label);
  // As SelectionControl does with alignFirstLine: the box centres on the first line at the scale it renders with.
  const lineHeight = typography.body.lineHeight * (isWeb ? theme.fontScale : PixelRatio.getFontScale());
  const id = `${routeId}.${String(name)}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const error = fieldMessage(t, fieldState.error);
        const toggle = () => {
          haptics.selection();
          field.onChange(!field.value);
        };
        return (
          <View style={styles.consent}>
            <View style={styles.consentRow}>
              <View style={[styles.box, { height: lineHeight }]}>
                <Checkbox
                  checked={Boolean(field.value)}
                  onChange={field.onChange}
                  label={sentence}
                  error={Boolean(error)}
                  style={[styles.target, { top: (lineHeight - size.touchMin) / 2 }]}
                  testID={id}
                />
              </View>
              <Text
                variant="body"
                selectable={false}
                aria-hidden={linked ? undefined : true}
                onPress={toggle}
                style={styles.label}
                testID={`${id}.label`}
              >
                {parts && linked
                  ? parts.map((part, position) => {
                      const href = part.kind === 'link' ? hrefs[part.index] : undefined;
                      if (part.kind === 'text' || !href) return <Fragment key={position}>{part.text}</Fragment>;
                      return (
                        <DocLink
                          key={position}
                          href={href}
                          label={part.text}
                          closing={part.closing}
                          testID={part.index === 0 ? `${id}.read` : `${id}.read${part.index}`}
                        />
                      );
                    })
                  : sentence}
              </Text>
            </View>
            {error ? (
              <View style={styles.error}>
                <View style={styles.errorIcon}>
                  <Icon name="warning" size={16} color="accent.fg" />
                </View>
                <Text variant="caption" color="accent.fg" role="alert" style={styles.errorText} testID={`${id}.error`}>
                  {error}
                </Text>
              </View>
            ) : null}
          </View>
        );
      }}
    />
  );
}
