import { TIME_ZONE, type FormatLocale } from '@/lib/format';

/** As WEB-08 prints it (Carbon `isoFormat('LL')`): "6. November 2026", "November 6, 2026". */
const LEGAL_DATE_LOCALE: Record<FormatLocale, string> = { de: 'de-DE', en: 'en-US' };

/**
 * The date a legal text is in force from, written out and in the zone of the public page, so app and site print the same day. It stays
 * on one line (§4 never break key data), so that no line ends on "6.".
 */
export function formatLegalDate(date: Date, locale: FormatLocale): string {
  const written = new Intl.DateTimeFormat(LEGAL_DATE_LOCALE[locale], { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE }).format(date);
  return written.replaceAll(' ', '\u00A0');
}
