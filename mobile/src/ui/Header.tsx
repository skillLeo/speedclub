import { StatusBar } from 'expo-status-bar';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { keepShortNamesTogether } from '@/lib/format';
import { isAndroid } from '@/lib/platform';
import { createStyles, layout, size, space, useBreakpoint, useTheme } from '@/theme';

import { Hairline } from './Hairline';
import { IconButton } from './IconButton';
import { Icon, type IconName } from './icons/Icon';
import { PressableScale } from './PressableScale';
import { useSafeEdge } from './safeArea';
import { Text } from './Text';
import { UnreadBadge } from './UnreadBadge';
import type { CollapsingHeader } from './useCollapsingHeader';

export type HeaderAction = {
  icon: IconName;
  /** Required: an icon-only control has no other name. */
  label: string;
  onPress: () => void;
  selected?: boolean;
  disabled?: boolean;
  /** IconButton's `locked`: why the action is unavailable now; it looks disabled and a press says why. */
  locked?: string | null;
  /** Unread dot, or a count pill with `count`, on the icon. `label` joins the button's accessible name. */
  unread?: { count?: number; label: string };
  testID?: string;
};

export type HeaderProps = {
  /** `large` for tab roots (add `HeaderLargeTitle` to the list), `compact` for pushed screens, `photo` over a hero. */
  variant?: 'large' | 'compact' | 'photo';
  /** `headline`, centred. */
  title?: string;
  /** From `useCollapsingHeader()`. Without it the bar stays in its resting state. */
  scroll?: CollapsingHeader;
  /** Shows the leading control. */
  onBack?: () => void;
  /** Accessible name of the leading control; defaults to the common back or close string. */
  backLabel?: string;
  /** `close` for modal stacks. */
  backIcon?: 'back' | 'close';
  /** "Chevron + previous title" (§8). Not on narrow widths and not on Android. */
  backTitle?: string;
  actions?: readonly HeaderAction[];
  /** After `actions`, for a text action such as "Speichern". */
  trailing?: ReactNode;
  /**
   * Compact bar only: content of its own in place of the centred title, start-aligned between back and the actions, for example
   * FS-7's avatar with name and @username. It takes the remaining width; `title` is then not drawn.
   */
  titleContent?: ReactNode;
  /** Photo variant: scroll distance after which the solid bar replaces the photo, usually the hero height. */
  collapseAt?: number;
  /** False when the parent already pads the status bar. The Header owns it by default: use `Screen edges={['left','right']}`. */
  safeTop?: boolean;
  /**
   * Wide screens: back, title and trailing keep to a column this wide from the start edge, so they line up with the
   * content under them. The bar, its ground and the hairline still span the pane (DQ-144).
   */
  contentMaxWidth?: number;
  /** Where that column sits: on the start edge (default), or centred for a screen whose column is centred (DQ-193). */
  contentAlign?: 'start' | 'center';
  /**
   * False when the screen draws the line itself further down, because fixed chrome follows the bar and content scrolls
   * under that instead (DISC-01's sticky search band, DQ-196).
   */
  hairline?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Sub-testIDs: `.back`, `.title`, `.hairline`, and `.content` with `contentMaxWidth`. */
  testID?: string;
};

export type HeaderLargeTitleProps = {
  title: string;
  /** Measures the block, so a title that wraps at 200 % font collapses at its real height. */
  scroll?: CollapsingHeader;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The title takes over during the last stretch of the collapse. */
const FADE_DISTANCE = space[8];
/** Back title narrower than this leaves the centred title no room. */
const BACK_TITLE_MIN_WIDTH = layout.compactMaxWidth + 1;
/** From this font scale a centred one-liner between the controls would be clipped, so the compact title gets its own line. */
const STACKED_TITLE_FONT_SCALE = 1.3;

const useStyles = createStyles((t) => ({
  bar: { backgroundColor: t.color.bg.canvas },
  photoBar: {
    left: 0,
    pointerEvents: 'box-none',
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: t.zIndex.header,
  },
  solid: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: t.color.bg.canvas, pointerEvents: 'none' },
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: t.size.header },
  photoRow: { pointerEvents: 'box-none' },
  column: { alignSelf: 'flex-start', pointerEvents: 'box-none', width: '100%' },
  columnCentred: { alignSelf: 'center' },
  slot: { alignItems: 'center', flexDirection: 'row' },
  titleContent: { flex: 1, minWidth: 0 },
  titleBox: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    pointerEvents: 'none',
    position: 'absolute',
    top: 0,
  },
  titleStacked: { paddingBottom: t.space[8] },
  hairline: { bottom: 0, left: 0, pointerEvents: 'none', position: 'absolute', right: 0 },
  backRow: { alignItems: 'center', flexDirection: 'row', minHeight: t.size.iconButton, paddingRight: t.space[8] },
  backGlyph: { alignItems: 'center', height: t.size.iconButton, justifyContent: 'center', width: t.size.iconButton },
  backText: { flexShrink: 1 },
  action: { pointerEvents: 'box-none' },
  dot: { pointerEvents: 'none', position: 'absolute', right: t.space[8], top: t.space[8] },
  large: { justifyContent: 'flex-end', minHeight: t.size.headerLargeTitleBlock, paddingBottom: t.space[8] },
}));

function useProgress(variant: NonNullable<HeaderProps['variant']>, scroll: CollapsingHeader | undefined, collapseAt: number) {
  return useDerivedValue(() => {
    if (!scroll) return variant === 'compact' ? 1 : 0;
    const y = scroll.scrollY.get();
    if (variant === 'compact') return 1;
    const end = variant === 'photo' ? collapseAt : scroll.collapseAt.get();
    return interpolate(y, [end - FADE_DISTANCE, end], [0, 1], Extrapolation.CLAMP);
  });
}

/**
 * §8 header: compact 44 + status bar with a centred `headline`, hairline when content scrolls under it, 44 × 44
 * actions. Everything animates through opacity on the UI thread, driven by `useCollapsingHeader()`.
 */
export function Header({
  variant = 'compact',
  title,
  scroll,
  onBack,
  backLabel,
  backIcon = 'back',
  backTitle,
  actions,
  trailing,
  titleContent,
  collapseAt = size.headerLargeTitleBlock,
  safeTop = true,
  contentMaxWidth,
  contentAlign = 'start',
  hairline = true,
  style,
  testID,
}: HeaderProps) {
  const { t } = useTranslation('common');
  const styles = useStyles();
  const theme = useTheme();
  const { width, gutter } = useBreakpoint();
  const safe = useSafeEdge('top');
  const onPhoto = variant === 'photo';
  const [leadingWidth, setLeadingWidth] = useState<number>(size.iconButton);
  const [trailingWidth, setTrailingWidth] = useState<number>(size.iconButton);
  const [solid, setSolid] = useState(false);

  const progress = useProgress(variant, scroll, collapseAt);

  useAnimatedReaction(
    () => progress.get() > 0.5,
    (next, previous) => {
      if (onPhoto && next !== previous) scheduleOnRN(setSolid, next);
    },
  );

  const titleStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const solidStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const hairlineStyle = useAnimatedStyle(() => {
    if (!scroll || !hairline) return { opacity: 0 };
    if (variant === 'photo') return { opacity: progress.get() };
    // Compact and large alike: the moment content scrolls under the bar, not only once the compact title is in.
    return { opacity: interpolate(scroll.scrollY.get(), [0, FADE_DISTANCE], [0, 1], Extrapolation.CLAMP) };
  });

  // DQ-157: the chips belong to the photo. Once the solid bar has faded in over FADE_DISTANCE of scroll, back and the
  // actions are the plain icon buttons of every other header, in every theme; they switch at the fade's midpoint, with the
  // status bar.
  const chipVariant = onPhoto && !solid ? 'onPhoto' : 'default';
  const glyph = backIcon === 'close' ? 'x' : 'caret-left';
  const backName = backLabel ?? t(backIcon === 'close' ? 'actions.close' : 'actions.back');
  const largeFont = theme.fontScale >= STACKED_TITLE_FONT_SCALE;
  // Tab roots and photo bars keep the overlay: their title only appears on scroll and repeats one already on the screen.
  const ownTitle = variant === 'compact' && titleContent !== undefined && titleContent !== null;
  const stackedTitle = largeFont && variant === 'compact' && Boolean(title) && !ownTitle;
  const showBackTitle = Boolean(backTitle) && !onPhoto && !isAndroid && !largeFont && width >= BACK_TITLE_MIN_WIDTH;
  const titlePad = Math.max(leadingWidth, trailingWidth) + (gutter - space[12]);
  const widthFrom = (setter: (value: number) => void) => (event: LayoutChangeEvent) =>
    setter(event.nativeEvent.layout.width);

  const content = (
    <>
      {/* Gutter minus the 12 of air inside a 44 target: the glyph lines up with the content. */}
      <View style={[styles.row, onPhoto ? styles.photoRow : null, { paddingHorizontal: gutter - space[12] }]}>
        <View style={styles.slot} onLayout={widthFrom(setLeadingWidth)}>
          {onBack && showBackTitle ? (
            <PressableScale
              role="button"
              aria-label={`${backName}: ${backTitle}`}
              onPress={onBack}
              contentStyle={styles.backRow}
              testID={testID ? `${testID}.back` : undefined}
            >
              <View style={styles.backGlyph}>
                <Icon name={glyph} size={24} color="text.primary" />
              </View>
              <Text
                variant="body"
                numberOfLines={1}
                selectable={false}
                style={[styles.backText, { maxWidth: width / 4 }]}
              >
                {backTitle}
              </Text>
            </PressableScale>
          ) : onBack ? (
            <IconButton
              icon={glyph}
              label={backName}
              variant={chipVariant}
              onPress={onBack}
              testID={testID ? `${testID}.back` : undefined}
            />
          ) : null}
        </View>
        {ownTitle ? <View style={styles.titleContent}>{titleContent}</View> : null}
        {title && !stackedTitle && !ownTitle ? (
          <Animated.View style={[styles.titleBox, { left: titlePad, right: titlePad }, titleStyle]}>
            <Text
              variant="headline"
              numberOfLines={1}
              role={variant === 'large' ? undefined : 'heading'}
              aria-hidden={variant === 'large'}
              testID={testID ? `${testID}.title` : undefined}
            >
              {title}
            </Text>
          </Animated.View>
        ) : null}
        <View style={styles.slot} onLayout={widthFrom(setTrailingWidth)}>
          {actions?.map((action) => (
            <View key={action.label} style={styles.action}>
              <IconButton
                icon={action.icon}
                label={action.unread ? `${action.label}, ${action.unread.label}` : action.label}
                variant={chipVariant}
                onPress={action.onPress}
                selected={action.selected}
                disabled={action.disabled}
                locked={action.locked}
                testID={action.testID}
              />
              {action.unread ? <UnreadBadge count={action.unread.count} style={styles.dot} /> : null}
            </View>
          ))}
          {trailing}
        </View>
      </View>
      {stackedTitle ? (
        <Text
          variant="headline"
          role="heading"
          hyphenate={false}
          style={[styles.titleStacked, { paddingHorizontal: gutter }]}
          testID={testID ? `${testID}.title` : undefined}
        >
          {title ? keepShortNamesTogether(title) : null}
        </Text>
      ) : null}
    </>
  );

  return (
    <View
      dataSet={{ qaExempt: 'safe-area' }}
      style={[onPhoto ? styles.photoBar : styles.bar, safeTop ? safe : null, style]}
      testID={testID}
    >
      {onPhoto ? (
        <>
          <StatusBar style={solid && theme.colorScheme === 'light' ? 'dark' : 'light'} />
          <Animated.View style={[styles.solid, solidStyle]} />
        </>
      ) : null}
      {contentMaxWidth === undefined ? (
        content
      ) : (
        <View
          style={[styles.column, contentAlign === 'center' ? styles.columnCentred : null, { maxWidth: contentMaxWidth }]}
          testID={testID ? `${testID}.content` : undefined}
        >
          {content}
        </View>
      )}
      <Animated.View style={[styles.hairline, hairlineStyle]} testID={testID ? `${testID}.hairline` : undefined}>
        <Hairline />
      </Animated.View>
    </View>
  );
}

/**
 * The `title.l` block of a tab root. Put it first in the scrolling content, so it scrolls under the bar with the list.
 * At least 52 high, with the title on its lower edge and 8 below it.
 */
export function HeaderLargeTitle({ title, scroll, style, testID }: HeaderLargeTitleProps) {
  const styles = useStyles();
  const { gutter } = useBreakpoint();
  return (
    <View
      style={[styles.large, { paddingHorizontal: gutter }, style]}
      onLayout={(event) => scroll?.collapseAt.set(event.nativeEvent.layout.height)}
      testID={testID}
    >
      <Text variant="titleL" role="heading">
        {title}
      </Text>
    </View>
  );
}
