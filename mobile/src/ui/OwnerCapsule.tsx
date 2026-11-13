import { useState } from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { createStyles, layout, size, space, useBreakpoint, useTheme } from '@/theme';

import { Button } from './Button';
import { ChromeSurface } from './chrome';
import { ContextMenuButton, type ContextMenuItem } from './ContextMenu';
import { IconButton } from './IconButton';
import type { IconName } from './icons/Icon';

export type OwnerCapsuleAction = {
  key: string;
  icon: IconName;
  /** Required: the actions are glyphs only ("Bearbeiten", "Fotos", "Mods", "QR-Code"). */
  label: string;
  onPress: () => void;
  /**
   * DQ-979: which glyph stays when the capsule is narrow; lower stays longer. 09 §5's order for the owner: QR (0) > Bearbeiten (1)
   * > Mods (2) > Fotos (3). Without it the array order decides.
   */
  priority?: number;
  /** Replaces `<testID>.<key>` (GAR-02 keeps its tool IDs, `GAR-02.tool.edit`). */
  testID?: string;
};

export type OwnerCapsuleProps = {
  /** "Update posten": the capsule's one filled action (S primary). */
  primary: { label: string; onPress: () => void };
  /** Bearbeiten, Fotos, Mods, QR: at most four glyph actions. */
  actions: readonly OwnerCapsuleAction[];
  /** The rest behind "Mehr" (a ContextMenu). */
  more?: { label: string; items: readonly ContextMenuItem[] };
  /** The toolbar's name for screen readers: "Aktionen für deinen Build". */
  label: string;
  /** The caller places it: bottom centre, above the tab bar and the safe area. */
  style?: StyleProp<ViewStyle>;
  /** The width the capsule may take where it is not the window between the gutters (the desktop side card). */
  availableWidth?: number;
  /** Sub-testIDs: `.primary`, `.<action key>`, `.more`. */
  testID?: string;
};

/** 09 §5 caps the capsule at four glyph actions beside the primary and "Mehr". */
export const OWNER_CAPSULE_MAX_ACTIONS = 4;
/**
 * DQ-957: below the large-phone width the capsule inside the 20 gutters has room for three glyphs beside "Update posten" and
 * "Mehr" (8 + ≈ 120 + 5 × 44 + gaps would pass 350). The one of lowest priority moves into "Mehr" (DQ-979: QR stays).
 */
export const OWNER_CAPSULE_MAX_ACTIONS_NARROW = 3;

/**
 * DQ-1049: how many glyph actions fit beside a primary `primaryWidth` wide in a capsule at most `available` wide, with "Mehr" when
 * `withMore`. The primary never wraps ("Update posten" stays one line at 375 and at 200 %); glyphs move into "Mehr" first.
 */
export function ownerCapsuleFit(available: number, primaryWidth: number, withMore: boolean): number {
  if (available <= 0 || primaryWidth <= 0) return OWNER_CAPSULE_MAX_ACTIONS;
  // Padding (8 + 4), the primary's margin (4), the Hell edge (1 on each side) and 2 for the sub-pixel widths of a measured primary:
  // at 1440 and 200 % the capsule in the desktop card ran 2.34 past the viewport with the edge and rounding left out (m4.10 VEH-01-owner).
  const chrome = space[8] + space[4] + space[4] + 2 * size.border.control + space[2];
  const slot = size.touchMin + space[2];
  const room = available - chrome - primaryWidth - (withMore ? slot : 0);
  return Math.max(0, Math.min(OWNER_CAPSULE_MAX_ACTIONS, Math.floor(room / slot)));
}

/** How many glyph actions show at a window `width`; the rest go into "Mehr". */
export function ownerCapsuleVisibleActions(width: number): number {
  return width < layout.phoneLargeMinWidth ? OWNER_CAPSULE_MAX_ACTIONS_NARROW : OWNER_CAPSULE_MAX_ACTIONS;
}

/**
 * DQ-979: the `count` actions of highest priority stay, in their own order; the rest go into "Mehr" by priority. Without
 * priorities the array order decides, as before.
 */
export function splitByPriority<T extends { priority?: number }>(actions: readonly T[], count: number): { visible: T[]; hidden: T[] } {
  const rank = (action: T, index: number) => action.priority ?? OWNER_CAPSULE_MAX_ACTIONS + index;
  const kept = new Set(
    actions
      .map((action, index) => ({ action, rank: rank(action, index) }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, count)
      .map((entry) => entry.action),
  );
  const hidden = actions.filter((action) => !kept.has(action)).sort((a, b) => rank(a, actions.indexOf(a)) - rank(b, actions.indexOf(b)));
  return { visible: actions.filter((action) => kept.has(action)), hidden };
}

const useStyles = createStyles((t) => ({
  // The page gutter on both sides (20, 24 from 430), so the capsule never runs past the content's edges.
  frame: { alignItems: 'center' },
  capsule: {
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: '100%',
    borderRadius: t.radius.full,
    flexDirection: 'row',
    gap: t.space[2],
    paddingLeft: t.space[8],
    paddingRight: t.space[4],
    paddingVertical: t.space[4],
  },
  // DQ-1049: the primary keeps its one line; glyphs give way instead.
  primary: { flexShrink: 0, marginRight: t.space[4] },
  // DQ-1049: in Hell the translucent ground over the light canvas needs its edge (border.subtle hairline) to read as one capsule.
  edge: { borderColor: t.color.border.subtle, borderWidth: t.size.border.control },
}));

/**
 * 09 §5 OwnerCapsule: the floating bottom capsule on the owner's screens (GAR-02, owner VEH-01): "Update posten" as S primary
 * and glyph actions (Bearbeiten, Fotos, Mods, QR, Mehr), each with a 44 target. Its material is the floating chrome: GlassView
 * on iOS where Liquid Glass is available, `chrome.translucent` on Android and web, opaque under reduced transparency (09 §4.4).
 * It is a toolbar for screen readers and the keyboard (one tab stop per action, in reading order).
 */
export function OwnerCapsule({ primary, actions, more, label, style, availableWidth, testID }: OwnerCapsuleProps) {
  const styles = useStyles();
  const { width, gutter } = useBreakpoint();
  const light = useTheme().colorScheme === 'light';
  const capped = actions.slice(0, OWNER_CAPSULE_MAX_ACTIONS);
  const [primaryWidth, setPrimaryWidth] = useState(0);
  const onPrimaryLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setPrimaryWidth((current) => (current === next ? current : next));
  };
  const available = availableWidth ?? width - 2 * gutter;
  const byWidth = more ? ownerCapsuleVisibleActions(available + 2 * gutter) : OWNER_CAPSULE_MAX_ACTIONS;
  const visibleCount = more ? Math.min(byWidth, ownerCapsuleFit(available, primaryWidth, true)) : byWidth;
  const { visible, hidden } = splitByPriority(capped, visibleCount);
  const overflow: ContextMenuItem[] = hidden.map((action) => ({
    key: action.key,
    label: action.label,
    icon: action.icon,
    onSelect: action.onPress,
  }));
  const moreItems = more ? [...overflow, ...more.items] : [];
  return (
    <View role="toolbar" aria-label={label} style={[styles.frame, availableWidth === undefined ? { paddingHorizontal: gutter } : null, style]} testID={testID}>
      <ChromeSurface floating style={[styles.capsule, light ? styles.edge : null]} testID={testID ? `${testID}.surface` : undefined}>
        <View style={styles.primary} onLayout={onPrimaryLayout}>
          <Button label={primary.label} variant="primary" size="s" onPress={primary.onPress} testID={testID ? `${testID}.primary` : undefined} />
        </View>
        {visible.map((action) => (
          <IconButton key={action.key} icon={action.icon} label={action.label} onPress={action.onPress} testID={action.testID ?? (testID ? `${testID}.${action.key}` : undefined)} />
        ))}
        {more && moreItems.length > 0 ? <ContextMenuButton items={moreItems} label={more.label} testID={testID ? `${testID}.more` : undefined} /> : null}
      </ChromeSurface>
    </View>
  );
}
