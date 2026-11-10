import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { isWeb } from '@/lib/platform';
import { createStyles, typography, useTheme, type TypeVariant } from '@/theme';

import { Button, type ButtonSize, type ButtonVariant } from './Button';
import { Icon, type IconName } from './icons/Icon';
import { Text, typeStyle } from './Text';

export type EmptyStateAction = {
  label: string;
  onPress: () => void;
  /**
   * DQ-226, the rule for the one button: an action that makes or retries something here is Primary L, the default (FS-4); a way off
   * this page ("Zur Garage", "Builds entdecken") is Secondary M, because there it is not what the page is for.
   */
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Offline or restricted: the action stays in view, as the header's does, but takes no taps. */
  disabled?: boolean;
};

export type EmptyStateProps = {
  title: string;
  /** One line of explanation. */
  body?: string;
  /** Off where the line is short and its words fit whole at every width, so a split word would only look clipped. */
  hyphenateBody?: boolean;
  /** Glyph 48. */
  icon?: IconName;
  /** A brand illustration instead of the glyph, 120 at most. */
  illustration?: ReactNode;
  /** `brand` (FS-4, brand moments only) draws the glyph inside the katakana hairline frame. */
  variant?: 'default' | 'brand';
  /** The one button. */
  action?: EmptyStateAction;
  /** ErrorState: announces the state as it appears. */
  role?: 'alert';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The brand mark in the frame (§2). It is not copy: it stays the same in every language and is hidden from readers. */
const KATAKANA = 'スピードクラブ';
const KATAKANA_VARIANT: TypeVariant = 'badge';
/**
 * DQ-255: a centred line that wraps must not leave one short word alone ("… schließ / sie."). Browsers that know `text-wrap:
 * balance` even out the lines; native has no such style, and the copy is written to wrap well there.
 */
const BODY_WRAP = isWeb ? ({ textWrap: 'balance' } as unknown as TextStyle) : undefined;

const useStyles = createStyles((t) => {
  const line = isWeb ? t.size.border.control : StyleSheet.hairlineWidth;
  const stroke = t.color.border.default;
  return {
    root: { alignItems: 'center', alignSelf: 'center', maxWidth: t.size.dialogMaxWidth, paddingHorizontal: t.space[16], paddingVertical: t.space[32] },
    title: { marginTop: t.space[16], textAlign: 'center' },
    titleOnly: { textAlign: 'center' },
    body: { marginTop: t.space[8], textAlign: 'center' },
    action: { alignSelf: 'center', marginTop: t.space[24] },
    illustration: {
      alignItems: 'center',
      justifyContent: 'center',
      maxHeight: t.size.emptyIllustrationMax,
      maxWidth: t.size.emptyIllustrationMax,
    },
    frame: { height: t.size.emptyIllustrationMax, width: t.size.emptyIllustrationMax },
    frameTop: { alignItems: 'flex-end', flexDirection: 'row', gap: t.space[4] },
    frameTopLeft: { borderLeftColor: stroke, borderLeftWidth: line, borderTopColor: stroke, borderTopWidth: line, flex: 1 },
    frameTopRight: { borderRightColor: stroke, borderRightWidth: line, borderTopColor: stroke, borderTopWidth: line, flex: 1 },
    frameMark: { flexShrink: 0 },
    frameBody: {
      alignItems: 'center',
      borderBottomColor: stroke,
      borderBottomWidth: line,
      borderLeftColor: stroke,
      borderLeftWidth: line,
      borderRightColor: stroke,
      borderRightWidth: line,
      flex: 1,
      justifyContent: 'center',
    },
  };
});

/**
 * FS-4: the top edge of the frame carries the katakana between two hairline rules. The rules start at the middle of
 * the text line and turn into the sides, so the outline is closed. Badge type is capped at 1.3, so it always fits 120.
 */
function BrandFrame({ icon, testID }: { icon: IconName; testID?: string }) {
  const styles = useStyles();
  const theme = useTheme();
  const scale = isWeb ? theme.fontScale : 1;
  const lineHeight = typeStyle(KATAKANA_VARIANT, scale).lineHeight ?? typography[KATAKANA_VARIANT].lineHeight;
  const corner = { height: lineHeight / 2 };
  return (
    <View aria-hidden style={styles.frame} testID={testID}>
      <View style={styles.frameTop}>
        <View style={[styles.frameTopLeft, corner]} />
        <Text variant={KATAKANA_VARIANT} color="text.secondary" allowFontScaling={false} selectable={false} style={styles.frameMark}>
          {KATAKANA}
        </Text>
        <View style={[styles.frameTopRight, corner]} />
      </View>
      <View style={styles.frameBody}>
        <Icon name={icon} size={48} color="text.secondary" />
      </View>
    </View>
  );
}

/** §8 empty state: one glyph 48 or an illustration up to 120, `title.s`, one line `body.dense`, one button. */
export function EmptyState({ title, body, hyphenateBody = true, icon, illustration, variant = 'default', action, role, style, testID }: EmptyStateProps) {
  const styles = useStyles();
  const part = (name: string) => (testID ? `${testID}.${name}` : undefined);
  const hasVisual = Boolean(illustration || icon);

  return (
    <View role={role} testID={testID} style={[styles.root, style]}>
      {illustration ? (
        <View style={styles.illustration}>{illustration}</View>
      ) : icon ? (
        variant === 'brand' ? (
          <BrandFrame icon={icon} testID={part('frame')} />
        ) : (
          <Icon name={icon} size={48} color="text.secondary" />
        )
      ) : null}
      <Text
        variant="titleS"
        role="heading"
        {...({ 'aria-level': 2 } as object)}
        style={[hasVisual ? styles.title : styles.titleOnly, BODY_WRAP]}
        testID={part('title')}
      >
        {title}
      </Text>
      {body ? (
        <Text variant="bodyDense" color="text.secondary" hyphenate={hyphenateBody} style={[styles.body, BODY_WRAP]} testID={part('body')}>
          {body}
        </Text>
      ) : null}
      {action ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          variant={action.variant ?? 'primary'}
          size={action.size ?? 'l'}
          loading={action.loading}
          disabled={action.disabled}
          style={styles.action}
          testID={part('action')}
        />
      ) : null}
    </View>
  );
}
