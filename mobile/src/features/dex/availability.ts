import { isWeb } from '@/lib/platform';

/** ADR-508: the scanner exists in the app only; the member web shows "Spotten geht nur in der App". */
export function scannerAvailable(): boolean {
  return !isWeb;
}
