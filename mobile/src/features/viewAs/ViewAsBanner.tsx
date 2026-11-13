import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { createStyles, useBreakpoint, useTheme } from '@/theme';
import { Icon, Spinner, Text } from '@/ui';
import { useFocusRing } from '@/ui/useFocusRing';

import { endViewAs, useViewAsStore } from './viewAsSession';

const useStyles = createStyles((t) => ({
  // The one red surface allowed beyond §3's list (m3.2-contract §3): a slim warning bar, no brand. accent.fill with text.onAccent is
  // the red fill that passes AA (5.9:1) in all three themes. One line is 44, the height of its one control.
  bar: {
    alignItems: 'center',
    backgroundColor: t.color.accent.fill,
    columnGap: t.space[12],
    flexDirection: 'row',
    minHeight: t.size.touchMin,
  },
  // DQ-672: above font scale 1 the text takes the bar's width, and "Beenden" sits under it at the end, never wedged between its lines.
  barStacked: { alignItems: 'stretch', flexDirection: 'column', paddingTop: t.space[4] },
  endStacked: { alignSelf: 'flex-end' },
  // Its own height in the column: `flex: 0` on web is a basis of 0 %, which left the text 8 px of room and ran it out of the top.
  messageStacked: { flexBasis: 'auto', flexGrow: 0, flexShrink: 0 },
  message: { alignItems: 'center', columnGap: t.space[8], flex: 1, flexDirection: 'row', minWidth: 0, paddingVertical: t.space[4] },
  text: { flexShrink: 1 },
  // One line (ADR-228): the name gives way with an ellipsis, "· nur lesen" always stays whole.
  line: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, minWidth: 0 },
  name: { flexShrink: 1, minWidth: 0 },
  suffix: { flexShrink: 0 },
  // 44 × 44 at least, the outline marks it as the bar's control.
  end: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: t.size.touchMin,
    minWidth: t.size.touchMin,
  },
  endShape: {
    alignItems: 'center',
    borderColor: t.color.text.onAccent,
    borderRadius: t.radius.sm,
    borderWidth: t.size.border.control,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: t.size.button.s - t.space[8],
    paddingHorizontal: t.space[12],
  },
}));

/**
 * The view-as bar on every screen (m3.2-contract §3): "Ansicht als @user – nur lesen" and "Beenden", which revokes the token and
 * leaves the tab on "Ansicht beendet". A status region, so a screen reader hears it once; the staff member's name is part of its name.
 */
export function ViewAsBanner() {
  const { t } = useTranslation('auth');
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  const ring = useFocusRing('onPhoto');
  const username = useViewAsStore((state) => state.username);
  const staff = useViewAsStore((state) => state.staff);
  const ending = useViewAsStore((state) => state.status === 'ending');
  const { fontScale } = useTheme();
  const name = username ? t('viewAs.bannerName', { username }) : t('viewAs.bannerNameNone');
  const readOnly = t('viewAs.bannerReadOnly');
  // One line: its own unit after the name, which gives way. Wrapped (DQ-672): the line may break before the "·", never after it, and
  // "· nur lesen" stays whole.
  const suffix = `\u00a0· ${readOnly}`;
  const wrappedSuffix = ` ·\u00a0${readOnly.replace(/ /g, '\u00a0')}`;
  const text = username ? t('viewAs.banner', { username }) : t('viewAs.bannerNoName');
  // ADR-228: one line of 44 at 360 and font scale 1, so the red stays a slim bar. A larger font wraps instead, with the same words.
  const oneLine = fontScale <= 1;

  return (
    <View
      role="status"
      aria-label={username && staff ? t('viewAs.bannerLabel', { username, staff }) : text}
      style={[styles.bar, oneLine ? null : styles.barStacked, { paddingLeft: gutter, paddingRight: gutter }]}
      testID="VIEWAS.banner"
    >
      <View style={[styles.message, oneLine ? null : styles.messageStacked]} testID="VIEWAS.banner.message">
        <Icon name="eye" size={16} color="text.onAccent" />
        {oneLine ? (
          <View style={styles.line} testID="VIEWAS.banner.text">
            <Text variant="callout" color="text.onAccent" hyphenate={false} numberOfLines={1} style={styles.name}>
              {name}
            </Text>
            <Text variant="callout" color="text.onAccent" hyphenate={false} numberOfLines={1} style={styles.suffix}>
              {suffix}
            </Text>
          </View>
        ) : (
          <Text variant="callout" color="text.onAccent" hyphenate={false} style={styles.text} testID="VIEWAS.banner.text">
            {name}
            {wrappedSuffix}
          </Text>
        )}
      </View>
      <Pressable
        role="button"
        aria-label={t('viewAs.endLabel')}
        aria-busy={ending}
        aria-disabled={ending}
        disabled={ending}
        onPress={() => void endViewAs('ended')}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        style={[styles.end, oneLine ? null : styles.endStacked]}
        testID="VIEWAS.end"
      >
        <View style={[styles.endShape, ring.ringStyle]}>
          {ending ? (
            <Spinner size={16} color="text.onAccent" decorative />
          ) : (
            <Text variant="bodyStrong" color="text.onAccent" selectable={false}>
              {t('viewAs.end')}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}
