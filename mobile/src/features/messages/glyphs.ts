/** The glyphs of messaging in one place, all from the design-system icon map (`ui/icons/Icon.tsx`). */
import type { IconName } from '@/ui';

export const MESSAGE_GLYPHS = {
  pinned: 'push-pin',
  muted: 'bell-slash',
  waiting: 'clock',
  failed: 'warning',
  photo: 'image',
  vehicle: 'garage',
  camera: 'camera',
  info: 'info',
  block: 'prohibit',
  delete: 'trash',
  report: 'flag',
  archive: 'archive',
  copy: 'copy',
  profile: 'user',
} as const satisfies Record<string, IconName>;
