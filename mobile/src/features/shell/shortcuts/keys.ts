/**
 * Web shortcuts [SIG `sig.web_shortcuts`] (02_PRODUCT_SPEC §5), desktop only: `/` focuses the search, ⌘K or Ctrl K opens the
 * quick switcher, `g` then h · d · g · m · p jumps to a tab, `?` opens the shortcut sheet. Never while the member types in a
 * field, never while an overlay is open, never with the IME composing. Pure, so the rules are tested without a browser.
 */
import type { TabName } from '../destinations';

export const SHORTCUTS_FLAG = 'sig.web_shortcuts';

/** How long `g` waits for its second key. */
export const SEQUENCE_TIMEOUT_MS = 1500;

export const TAB_KEYS: Readonly<Record<string, TabName>> = { h: 'home', d: 'discover', g: 'garage', m: 'messages', p: 'profile' };

export type ShortcutAction =
  | { kind: 'focusSearch' }
  | { kind: 'switcher' }
  | { kind: 'help' }
  | { kind: 'tab'; tab: TabName };

/** What the handler reads of a DOM KeyboardEvent. */
export type KeyLike = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
  target?: unknown;
};

/** What the handler reads of the focused element. */
type ElementLike = {
  tagName?: string;
  isContentEditable?: boolean;
  type?: string;
  getAttribute?: (name: string) => string | null;
  readOnly?: boolean;
};

const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);
/** Inputs that take no typing: a shortcut is fine while one of them has the focus. */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color', 'image']);

/** Whether the member is typing into this element: a text input, a text area, a select, editable content or a text role. */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const element = target as ElementLike;
  if (element.isContentEditable) return true;
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has((element.type ?? 'text').toLowerCase());
  const role = typeof element.getAttribute === 'function' ? element.getAttribute('role') : null;
  return role !== null && TEXT_ROLES.has(role);
}

export type ShortcutHandlerOptions = {
  /** Clock for the `g` sequence; tests pass their own. */
  now?: () => number;
  /** An overlay (sheet, dialog, the switcher itself) has the keyboard: shortcuts wait. */
  overlayOpen?: () => boolean;
};

/**
 * A keydown handler with the `g` state inside. Returns the action to run, or null when the key is not a shortcut here; the
 * caller prevents the browser's default only for an action.
 */
export function createShortcutHandler({ now = Date.now, overlayOpen = () => false }: ShortcutHandlerOptions = {}) {
  let pendingSince: number | null = null;

  return function handle(event: KeyLike): ShortcutAction | null {
    const pending = pendingSince;
    pendingSince = null;
    if (event.defaultPrevented || event.isComposing || overlayOpen() || isTypingTarget(event.target)) return null;
    const key = event.key;
    const modifier = Boolean(event.metaKey || event.ctrlKey);
    if (modifier && !event.altKey && !event.shiftKey && key.toLowerCase() === 'k') return { kind: 'switcher' };
    if (modifier || event.altKey) return null;
    if (pending !== null && now() - pending <= SEQUENCE_TIMEOUT_MS) {
      const tab = TAB_KEYS[key.toLowerCase()];
      if (tab && !event.shiftKey) return { kind: 'tab', tab };
      return null;
    }
    if (key === '?') return { kind: 'help' };
    if (key === '/' && !event.shiftKey) return { kind: 'focusSearch' };
    if (key === 'g' && !event.shiftKey) {
      pendingSince = now();
      return null;
    }
    return null;
  };
}

/** The rows of the shortcut sheet, in its order. `keys` are shown as separate key caps. */
export const SHORTCUT_ROWS = [
  { id: 'search', keys: ['/'] },
  { id: 'switcher', keys: ['mod', 'K'] },
  { id: 'home', keys: ['G', 'H'] },
  { id: 'discover', keys: ['G', 'D'] },
  { id: 'garage', keys: ['G', 'G'] },
  { id: 'messages', keys: ['G', 'M'] },
  { id: 'profile', keys: ['G', 'P'] },
  { id: 'help', keys: ['?'] },
] as const;

/** ⌘ on Apple keyboards, Ctrl everywhere else. */
export function modifierLabel(platform: string): '⌘' | 'Ctrl' {
  return /mac|iphone|ipad|ipod/i.test(platform) ? '⌘' : 'Ctrl';
}
