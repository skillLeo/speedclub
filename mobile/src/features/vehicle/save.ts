import type { IconName } from '@/ui';

/** The flag of saved builds (02_PRODUCT_SPEC §5). */
export const SAVED_BUILDS_FLAG = 'sig.saved_builds';

/**
 * The glyph of Speichern / Gespeichert: Phosphor `bookmark-simple`, regular when not saved, fill when saved. Every save control
 * reads it from here.
 */
export const SAVE_ICON: IconName = 'bookmark-simple';
