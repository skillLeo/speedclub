import { useMemo } from 'react';

import { apiOrigin } from '@/api/client';
import { useAppConfig } from '@/api/queries/appConfig';
import { BrandWordmark, type BrandWordmarkProps, type CustomWordmark } from '@/ui';

import { customWordmark } from './brand';

/** The published wide wordmarks of app-config (M3.5 ADM-28), per tone; null where the bundled file stays. */
export function useCustomWordmarks(): { white: CustomWordmark | null; black: CustomWordmark | null } {
  const { config } = useAppConfig();
  const { branding } = config;
  return useMemo(() => {
    const origin = apiOrigin();
    return { white: customWordmark(branding, 'white', origin), black: customWordmark(branding, 'black', origin) };
  }, [branding]);
}

/**
 * The wide logo where the app draws it (FS-1, the sidebar, SYS-01/02, GAR-04): the wordmark published in the admin at its own aspect
 * ratio, else the bundled file. The design gallery (DEV-01) keeps the bundled files.
 */
export function AppWordmark(props: Omit<BrandWordmarkProps, 'custom' | 'shape'>) {
  const custom = useCustomWordmarks();
  return <BrandWordmark {...props} custom={custom} />;
}
