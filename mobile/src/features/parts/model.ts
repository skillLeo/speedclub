/**
 * Pure helpers of the parts and business screens (M4.14): opening hours, the contact links, the Impressum rows (§ 5 DDG), the hero
 * photo of a business, counts and the badged samples of the empty states (09 §8.19). No React, so the tests read them directly.
 */
import type { TFunction } from 'i18next';

import type { BusinessCardData, BusinessDetail, Impressum, ModTag, OpeningDay } from '@/api/queries/businesses';
import type { FeedVehicle } from '@/api/queries/home';
import type { ProductRowData } from '@/api/queries/parts';
import { photoFields } from '@/features/profile/media';
import type { PhotoFields } from '@/ui';

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

type T = TFunction<'parts'> | ((key: string, options?: Record<string, unknown>) => string);
const tx = (t: T, key: string, options?: Record<string, unknown>): string => (t as (key: string, options?: Record<string, unknown>) => string)(key, options);

/** "08:00–12:00, 13:00–17:30"; a day without ranges is closed. En dash, no spaces (de-DE and en-GB alike). */
export function hoursText(day: Pick<OpeningDay, 'ranges'>, t: T): string {
  if (day.ranges.length === 0) return tx(t, 'business.hours.closed');
  return day.ranges.map((range) => `${range.opens}–${range.closes}`).join(', ');
}

/** The day's name ("Montag") from the API's key; an unknown key is shown as it came. */
export function dayLabel(day: string, t: T): string {
  return (DAY_KEYS as readonly string[]).includes(day) ? tx(t, `days.${day}`) : day;
}

/** Whether the business has any opening hours at all (a profile without them leaves the section out). */
export function hasHours(days: readonly OpeningDay[]): boolean {
  return days.some((day) => day.ranges.length > 0);
}

/** "Beispielweg 1", "20095 Hamburg" (+ the country outside Germany). */
export function addressLines(address: Pick<BusinessDetail['address'], 'street' | 'postcode' | 'city' | 'country'>, t: T): string[] {
  const lines = [address.street.trim(), `${address.postcode} ${address.city}`.trim()].filter(Boolean);
  if (address.country && address.country !== 'DE') lines.push(tx(t, `countries.${address.country}`));
  return lines;
}

/** "Route" in the platform's maps app: the pin when the business set one, else the address. */
export function routeUrl(address: BusinessDetail['address'], platform: 'ios' | 'android' | 'web'): string | null {
  const point = address.lat !== null && address.lng !== null ? `${address.lat},${address.lng}` : null;
  const query = point ?? [address.street, `${address.postcode} ${address.city}`, address.country].filter((part) => part.trim()).join(', ');
  if (!query.trim()) return null;
  if (platform === 'ios') return `https://maps.apple.com/?daddr=${encodeURIComponent(query)}`;
  if (platform === 'android') return `geo:0,0?q=${encodeURIComponent(query)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

/** `tel:` with digits and a leading + only; null when nothing callable is left. */
export function phoneUrl(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/(?!^\+)[^\d]/g, '');
  return /\d{3,}/.test(digits) ? `tel:${digits}` : null;
}

/** Only http(s) addresses open; anything else (javascript:, data:) is never a link. */
export function websiteUrl(website: string | null | undefined): string | null {
  if (!website) return null;
  const trimmed = website.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** "werkstatt-nord.de": the host without www, as the row shows it. */
export function websiteLabel(website: string): string {
  try {
    return new URL(websiteUrl(website) ?? website).host.replace(/^www\./, '');
  } catch {
    return website;
  }
}

export type ImpressumRow = { key: string; label: string; value: string };

/**
 * § 5 DDG (09 §8.10, ADR-414): name and legal form, the address, who represents the company, the contact, the register entry and the
 * VAT ID where there is one. Every row in the order of the law's list.
 */
export function impressumRows(impressum: Impressum, t: T): ImpressumRow[] {
  const register = [impressum.register_court, impressum.register_number].filter((part): part is string => Boolean(part?.trim())).join(', ');
  const address = [impressum.street, `${impressum.postcode} ${impressum.city}`.trim(), impressum.country !== 'DE' ? tx(t, `countries.${impressum.country}`) : null]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(', ');
  const rows: (ImpressumRow | null)[] = [
    { key: 'name', label: tx(t, 'impressum.name'), value: impressum.legal_name },
    { key: 'legalForm', label: tx(t, 'impressum.legalForm'), value: impressum.legal_form_label },
    { key: 'address', label: tx(t, 'impressum.address'), value: address },
    impressum.representative ? { key: 'representative', label: tx(t, 'impressum.representative'), value: impressum.representative } : null,
    { key: 'email', label: tx(t, 'impressum.email'), value: impressum.email },
    impressum.phone ? { key: 'phone', label: tx(t, 'impressum.phone'), value: impressum.phone } : null,
    register ? { key: 'register', label: tx(t, 'impressum.register'), value: register } : null,
    impressum.vat_id ? { key: 'vatId', label: tx(t, 'impressum.vatId'), value: impressum.vat_id } : null,
  ];
  return rows.filter((row): row is ImpressumRow => row !== null && row.value.trim() !== '');
}

/**
 * BIZ-01 has no business without a photo (skill rule 1): the business's own cover, else the newest portfolio build, else a licensed
 * seed photo of a wheel and caliper in a garage (design/seed-photos/CREDITS.md, the SYS-01 photo) captioned "Symbolbild".
 */
export const FALLBACK_COVER: PhotoFields = {
  source: require('@/assets/gallery/generic-wheels-01.jpg') as number,
  blurhash: 'LAAJ=-~p9]?cxvMxITogyX-;whI[',
  focal: { x: 0.35, y: 0.5 },
};

export type BusinessHero = { photo: PhotoFields; source: 'own' | 'portfolio' | 'fallback'; alt: string | null; vehicle: FeedVehicle | null };

export function businessHero(business: Pick<BusinessDetail, 'cover'>, portfolio: readonly FeedVehicle[], width: number): BusinessHero {
  if (business.cover) return { photo: photoFields(business.cover, width), source: 'own', alt: business.cover.alt, vehicle: null };
  const build = portfolio.find((vehicle) => vehicle.cover);
  if (build?.cover) return { photo: photoFields(build.cover, width), source: 'portfolio', alt: build.cover.alt, vehicle: build };
  return { photo: FALLBACK_COVER, source: 'fallback', alt: null, vehicle: null };
}

/** "In 14 Builds" / "In 1 Build"; nothing for zero or an uncounted list (never "In 0 Builds"). */
export function buildsLabel(count: number | null | undefined, t: T, format: (n: number) => string): string | null {
  if (count === null || count === undefined || count <= 0) return null;
  return tx(t, 'counts.inBuilds', { count, value: format(count) });
}

/** "12 km entfernt" in the member's distance unit (SET-11, `format.distance`). */
export function distanceLabel(km: number | null | undefined, t: T, distance: (km: number) => string): string | null {
  if (km === null || km === undefined || !Number.isFinite(km) || km < 0) return null;
  return tx(t, 'business.distance', { value: distance(km) });
}

/** The empty Betriebe scope's preview (09 §8.19): an obviously fictional workshop, badged "Beispiel", never sent anywhere. */
export function sampleBusiness(t: T): BusinessCardData {
  return {
    id: 'sample-business',
    slug: 'sample-business',
    name: tx(t, 'sample.businessName'),
    kind: 'workshop',
    kind_label: tx(t, 'kinds.workshop'),
    city: tx(t, 'sample.businessCity'),
    subline: `${tx(t, 'kinds.workshop')} · ${tx(t, 'sample.businessCity')}`,
    services: [tx(t, 'sample.serviceSuspension'), tx(t, 'sample.serviceExhaust'), tx(t, 'sample.serviceAlignment')],
    logo: null,
    verified: false,
    is_sample: true,
    distance_km: null,
    share_path: '',
  };
}

/** The empty Teile scope's preview: a sample row without a count, badged "Beispiel" by the caller. */
export function sampleProduct(t: T): ProductRowData {
  return {
    id: 'sample-product',
    slug: 'sample-product',
    name: tx(t, 'sample.productName'),
    full_name: tx(t, 'sample.productName'),
    line: null,
    brand: { slug: 'sample', name: tx(t, 'sample.productBrand') },
    category: { key: 'suspension', name: tx(t, 'sample.productCategory'), icon: 'coilover' },
    builds: null,
    status: 'active',
  };
}

/** The mod and build a tag is about, as one line: "KW Variante 3 · BMW M3 (E46)". */
export function tagSubject(tag: Pick<ModTag, 'mod' | 'vehicle'>, t: T): string {
  const mod = tag.mod?.title?.trim();
  const vehicle = tag.vehicle?.full_title?.trim();
  if (mod && vehicle) return `${mod} · ${vehicle}`;
  return mod ?? vehicle ?? tx(t, 'tags.goneSubject');
}
