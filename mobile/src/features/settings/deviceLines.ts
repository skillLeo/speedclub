const PLATFORM_LABELS: Readonly<Record<string, string>> = { ios: 'iOS', android: 'Android' };

/** SET-06 (DQ-457): a known platform by its product name; anything else ("web", unknown values) is left out rather than shown raw. */
export function platformLabel(platform: string | null): string | null {
  return platform ? (PLATFORM_LABELS[platform.toLowerCase()] ?? null) : null;
}
