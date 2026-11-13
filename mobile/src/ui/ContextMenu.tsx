import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, useWindowDimensions, View, type GestureResponderEvent, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { isWeb } from '@/lib/platform';
import { createStyles, motion as motionTokens, space } from '@/theme';

import { contextMenuPlacement, nextMenuIndex, type MenuRect } from './contextMenuLayout';
import { IconButton } from './IconButton';
import { Icon, type IconName } from './icons/Icon';
import { hapticFor, motionDuration, useMotionPreference } from './motion';
import { OverlayModal, Scrim, usePresence } from './overlay';
import { PressableScale } from './PressableScale';
import { useSafeInset } from './safeArea';
import { Text } from './Text';
import { keyOf } from './useRovingKeys';

export type ContextMenuItem = {
  key: string;
  label: string;
  icon?: IconName;
  /** Accent text, placed last: "Melden", "Entfernen". The confirm of an irreversible action stays a Dialog. */
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

type Host = ComponentRef<typeof View>;

const useStyles = createStyles((t) => ({
  fill: { bottom: 0, left: 0, pointerEvents: 'box-none', position: 'absolute', right: 0, top: 0 },
  panel: {
    backgroundColor: t.color.bg.overlay,
    borderRadius: t.radius.md,
    boxShadow: t.colorScheme === 'light' ? t.shadow.e2 : undefined,
    maxWidth: t.size.contextMenu.maxWidth,
    minWidth: t.size.contextMenu.minWidth,
    paddingVertical: t.space[4],
    position: 'absolute',
  },
  measuring: { opacity: 0 },
  item: { alignItems: 'center', flexDirection: 'row', gap: t.space[12], minHeight: t.size.touchMin, paddingHorizontal: t.space[16], paddingVertical: t.space[8] },
  itemFocused: { backgroundColor: t.color.state.hover },
  itemText: { flexShrink: 1 },
}));

/** Items in reading order: destructive ones last, as Dialog orders its actions. */
export function orderMenuItems(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  return [...items.filter((item) => !item.destructive), ...items.filter((item) => item.destructive)];
}

export type ContextMenuProps = {
  visible: boolean;
  /** Where it opened: the trigger's rect, or the long-press point (width and height 0), in window coordinates. */
  anchor: MenuRect | null;
  items: readonly ContextMenuItem[];
  /** The menu's accessible name: "Aktionen für Nissan Skyline GT-R R34". */
  label: string;
  onClose: () => void;
  testID?: string;
};

/**
 * 09 §5 ContextMenu, the cross-platform menu (the `@expo/ui` native menus are not installed in this SDK, so iOS and Android use
 * it too): a `bg.overlay` panel radius 12 by its anchor, rows of 44 with a 20 glyph and `body` label, destructive last in accent
 * text. It opens through the overlay primitive (an RN Modal, focus trapped on web, Escape and Android back close it) and pops
 * from 0.96 on spring.fast with an effect.fast fade; reduced motion fades only. Keyboard: the first item takes the focus,
 * Arrow up/down, Home and End move, Enter and Space choose, Escape closes and the focus returns to the trigger. Screen readers:
 * `menu` with `menuitem`s.
 */
export function ContextMenu(props: ContextMenuProps) {
  const motion = useMotionPreference();
  const mounted = usePresence(props.visible, motion.enabled ? motionDuration('effect.fast') : 0);
  return mounted && props.anchor ? <MenuPanel {...props} anchor={props.anchor} /> : null;
}

function MenuPanel({ visible, anchor, items, label, onClose, testID }: ContextMenuProps & { anchor: MenuRect }) {
  const styles = useStyles();
  const motion = useMotionPreference();
  const window = useWindowDimensions();
  const insetTop = useSafeInset('top');
  const insetBottom = useSafeInset('bottom');
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [focused, setFocused] = useState(-1);
  const refs = useRef<(Host | null)[]>([]);
  const progress = useSharedValue(0);
  const ordered = orderMenuItems(items);
  const enabled = ordered.map((item) => !item.disabled);
  const { reduced } = motion;

  useEffect(() => {
    if (size === null) return;
    progress.set(visible ? motion.springTo(1, 'fast') : motion.effectTo(0, 'fast'));
  }, [visible, size, progress, motion]);

  // The first enabled item takes the focus once the panel is placed (web; native screen readers start at the menu).
  useEffect(() => {
    if (!visible || size === null || !isWeb) return;
    const first = nextMenuIndex('Home', -1, enabled);
    // The item's onFocus records it as the current one.
    if (first !== null) refs.current[first]?.focus?.();
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `enabled` is derived from `items`, read on open only
  }, [visible, size === null]);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 1], [0, 1], 'clamp'),
    transform: reduced ? [] : [{ scale: interpolate(progress.get(), [0, 1], [motionTokens.signature.contextMenu.fromScale, 1]) }],
  }));

  const close = () => {
    if (visible) onClose();
  };
  const choose = (item: ContextMenuItem) => {
    if (!visible || item.disabled) return;
    onClose();
    item.onSelect();
  };
  const onKeyDown = (event: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
    const key = keyOf(event);
    if (key === 'Tab') {
      // A menu is one stop: Tab leaves it, as Escape does.
      event.preventDefault?.();
      close();
      return;
    }
    const next = key ? nextMenuIndex(key, focused, enabled) : null;
    if (next === null) return;
    event.preventDefault?.();
    setFocused(next);
    refs.current[next]?.focus?.();
  };
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) => (current && current.width === width && current.height === height ? current : { width, height }));
  };

  const place = size ? contextMenuPlacement(anchor, size, window, space[8], insetTop, insetBottom, space[4]) : null;

  return (
    <OverlayModal label={label} onRequestClose={close}>
      <Scrim progress={progress} onPress={close} testID={testID ? `${testID}.scrim` : undefined} />
      <View style={styles.fill}>
        <Animated.View
          role="menu"
          aria-label={label}
          accessibilityViewIsModal
          onAccessibilityEscape={close}
          onLayout={onLayout}
          {...(isWeb ? ({ onKeyDown } as object) : {})}
          style={[styles.panel, place ? { left: place.left, top: place.top } : styles.measuring, panelStyle]}
          testID={testID}
        >
          {ordered.map((item, index) => (
            <PressableScale
              key={item.key}
              ref={(node: Host | null) => {
                refs.current[index] = node;
              }}
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              disabled={item.disabled}
              feedback={false}
              ring="inset"
              onPress={() => choose(item)}
              onFocus={() => setFocused(index)}
              {...(isWeb
                ? ({
                    // Space on a menu item (react-native-web presses only buttons with it).
                    onKeyDown: (event: { key?: string; preventDefault?: () => void }) => {
                      if (event.key === ' ') {
                        event.preventDefault?.();
                        choose(item);
                      }
                    },
                  } as object)
                : {})}
              contentStyle={(state) => [styles.item, !item.disabled && (state.hovered || state.pressed) ? styles.itemFocused : null]}
              testID={testID ? `${testID}.${item.key}` : undefined}
            >
              {item.icon ? <Icon name={item.icon} size={20} color={item.disabled ? 'text.disabled' : item.destructive ? 'accent.fg' : 'text.secondary'} /> : null}
              <Text variant="body" color={item.disabled ? 'text.disabled' : item.destructive ? 'accent.fg' : 'text.primary'} style={styles.itemText} selectable={false}>
                {item.label}
              </Text>
            </PressableScale>
          ))}
        </Animated.View>
      </View>
    </OverlayModal>
  );
}

/** The menu's open state, anchored at a view or a point. */
export function useContextMenu() {
  const [anchor, setAnchor] = useState<MenuRect | null>(null);
  const [visible, setVisible] = useState(false);
  return {
    visible,
    anchor,
    openAt: (rect: MenuRect) => {
      setAnchor(rect);
      setVisible(true);
    },
    close: () => setVisible(false),
  };
}

function measure(node: Host | null, open: (rect: MenuRect) => void): void {
  node?.measureInWindow((x, y, width, height) => open({ x, y, width, height }));
}

export type ContextMenuButtonProps = {
  items: readonly ContextMenuItem[];
  /** The button's name and the menu's: "Weitere Aktionen". */
  label: string;
  icon?: IconName;
  variant?: 'default' | 'tonal' | 'onPhoto';
  style?: StyleProp<ViewStyle>;
  /** `.menu` and `.menu.<key>` for the panel and its items. */
  testID?: string;
};

/** The always-visible trigger (web, and every platform where an action must be findable without a long press). */
export function ContextMenuButton({ items, label, icon = 'dots-three', variant = 'default', style, testID }: ContextMenuButtonProps) {
  const ref = useRef<Host>(null);
  const menu = useContextMenu();
  return (
    <>
      <IconButton
        ref={ref}
        icon={icon}
        label={label}
        variant={variant}
        selected={menu.visible}
        {...({ 'aria-haspopup': 'menu', 'aria-expanded': menu.visible } as object)}
        onPress={() => measure(ref.current, menu.openAt)}
        style={style}
        testID={testID}
      />
      <ContextMenu visible={menu.visible} anchor={menu.anchor} items={items} label={label} onClose={menu.close} testID={testID ? `${testID}.menu` : undefined} />
    </>
  );
}

export type ContextMenuAreaProps = {
  items: readonly ContextMenuItem[];
  label: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Long press on native opens the menu at the finger (medium haptic, 09 §4.8 "long-press menu"); on the web a right click or
 * the context-menu key does, and the area also needs a visible ContextMenuButton (web has no long press). Screen readers get
 * the items as actions of the area, so nothing hides behind the gesture.
 */
export function ContextMenuArea({ items, label, children, style, testID }: ContextMenuAreaProps) {
  const ref = useRef<Host>(null);
  const menu = useContextMenu();
  const ordered = orderMenuItems(items).filter((item) => !item.disabled);
  const openAtPoint = (event: GestureResponderEvent) => {
    hapticFor('longPressMenu');
    const { pageX, pageY } = event.nativeEvent;
    menu.openAt({ x: pageX, y: pageY, width: 0, height: 0 });
  };
  const webHandlers = isWeb
    ? ({
        onContextMenu: (event: { preventDefault: () => void; clientX: number; clientY: number }) => {
          event.preventDefault();
          menu.openAt({ x: event.clientX, y: event.clientY, width: 0, height: 0 });
        },
        onKeyDown: (event: { key?: string; shiftKey?: boolean; preventDefault: () => void }) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            measure(ref.current, menu.openAt);
          }
        },
      } as object)
    : {};
  return (
    <>
      <Pressable
        ref={ref}
        accessible={!isWeb}
        onLongPress={isWeb ? undefined : openAtPoint}
        delayLongPress={motionTokens.signature.contextMenu.longPress}
        accessibilityActions={ordered.map((item) => ({ name: item.key, label: item.label }))}
        onAccessibilityAction={(event) => ordered.find((item) => item.key === event.nativeEvent.actionName)?.onSelect()}
        {...webHandlers}
        style={style}
        testID={testID}
      >
        {children}
      </Pressable>
      <ContextMenu visible={menu.visible} anchor={menu.anchor} items={items} label={label} onClose={menu.close} testID={testID ? `${testID}.menu` : undefined} />
    </>
  );
}
