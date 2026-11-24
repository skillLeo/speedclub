import type { ReactNode } from 'react';

/** Web: no tilt (spike §5: the Generic Sensor API is Chromium-only and would ask a permission for decoration). */
export function Tilt({ children }: { children: ReactNode; active?: boolean }) {
  return <>{children}</>;
}
