import { TIME_ZONE, type FormatLocale } from '@/lib/format';

/** As WEB-08 prints it (Carbon `isoFormat('LL')`): "6. November 2026", "November 6, 2026". */
const LEGAL_DATE_LOCALE: Record<FormatLocale, string> = { de: 'de-DE', en: 'en-US' };

/**
 * The date a legal text is in force from, written out and in the zone of the public page, so app and site print the same day. Day and
 * month stay together (§4 never break key data, so no line ends on "6."); the year may take the next line when the date is wider
 * than the line (DQ-1046: binding the whole date left "seit" alone on a line at 200 %; the copy binds "seit" to the day instead).
 */
export function formatLegalDate(date: Date, locale: FormatLocale): string {
  const written = new Intl.DateTimeFormat(LEGAL_DATE_LOCALE[locale], { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE }).format(date);
  return written.replace(' ', '\u00A0');
}
