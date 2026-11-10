import { useMemo } from 'react';

import { useTheme } from '@/theme';

/** Options of every stack layout: no native header, and the canvas behind each transition, where a default flashes white. */
export function useCanvasStackOptions() {
  const canvas = useTheme().color.bg.canvas;
  return useMemo(() => ({ headerShown: false, contentStyle: { backgroundColor: canvas } }), [canvas]);
}
