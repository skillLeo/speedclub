import { useEffect } from 'react';

import { useAppConfig } from '@/api/queries/appConfig';
import { setAccentSet, setDefaultThemePreference } from '@/theme';

/**
 * M3.5 ADM-28 brand pickup: the published accent set (a pre-validated set of tokens.json, never a free colour) and the default theme
 * for installs that never chose one. Bundled defaults while app-config has none.
 */
export function useBrandTheme(): void {
  const { config } = useAppConfig();
  const { accent_set: accentSet, default_theme: defaultTheme } = config.branding;
  useEffect(() => setAccentSet(accentSet), [accentSet]);
  useEffect(() => setDefaultThemePreference(defaultTheme), [defaultTheme]);
}

/** Renders nothing: mounted beside SessionHost in the root layout, so brand changes never re-render the session logic. */
export function BrandThemeSync(): null {
  useBrandTheme();
  return null;
}
