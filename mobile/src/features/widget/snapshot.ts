/**
 * Android widget "Mein Auto" (09 §8.14, ADR-454): the cached JSON the app writes and the widget reads. It holds what the widget
 * shows and nothing else: the main car's name, the path of its cropped photo on this device, and its next due maintenance item.
 * Never a token, an e-mail or a URL with a signature in it; the widget never asks the network (the app pushes every update).
 *
 * The countdown is kept as the server's `days_left` on the Berlin day it was written, so the widget's 6-hourly refresh can
 * count it down without the app (ADR-441: the server counts in Europe/Berlin).
 */
import { z } from 'zod';

import type { MaintenanceUpcoming } from '@/api/queries/maintenance';
import type { VehicleCardData } from '@/api/queries/profile';
import { berlinDay } from '@/features/maintenance/schemas';
import { itemTitle, sortItems, type DistanceUnit } from '@/features/maintenance/model';
import type { FormatLocale } from '@/lib/format';
import { numberOrNull } from '@/lib/numbers';

import type { TFunction } from 'i18next';

export const WIDGET_NAME = 'MeinAuto';
export const SNAPSHOT_VERSION = 1;

const dueSchema = z.object({
  /** "HU/AU", "Inspektion", or the custom item's title, in the member's language. */
  title: z.string(),
  /** The server's days to the due date on `day`; null when only a mileage is due. */
  days: z.number().int().nullable(),
  /** Kilometres to the due mileage, negative once past it. */
  km: z.number().nullable(),
  state: z.enum(['ok', 'soon', 'overdue', 'unknown']),
});

const photoSchema = z.object({
  /** file:// URI of the cropped JPEG in the app's documents (photo.ts). */
  uri: z.string().startsWith('file://'),
  mediaId: z.string(),
  /** The variant it was cut from: the same variant is never downloaded twice. */
  source: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
});

const carSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  eyebrow: z.string().nullable(),
  photo: photoSchema.nullable(),
  due: dueSchema.nullable(),
  /** The upcoming list was read and holds everything due for this car in the window: "nichts fällig" is true. */
  dueKnown: z.boolean(),
});

export const snapshotSchema = z.object({
  v: z.literal(SNAPSHOT_VERSION),
  /** Whose snapshot it is: a different member signing in replaces it before anything shows. */
  member: z.string().min(1),
  locale: z.enum(['de', 'en']),
  unit: z.enum(['km', 'mi']),
  /** The Berlin day `due.days` was counted on (YYYY-MM-DD). */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  car: carSchema.nullable(),
});

export type WidgetSnapshot = z.infer<typeof snapshotSchema>;
export type WidgetCar = NonNullable<WidgetSnapshot['car']>;
export type WidgetPhoto = NonNullable<WidgetCar['photo']>;
export type WidgetDue = NonNullable<WidgetCar['due']>;

/** A stored text that is not a valid snapshot (an older version, a torn write) reads as none. */
export function parseSnapshot(raw: string | null | undefined): WidgetSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = snapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The car the widget shows: the main vehicle, else the first one in the garage's order. Drafts stay out: a draft has no page to
 * open yet and often no name.
 */
export function pickMainVehicle(vehicles: readonly VehicleCardData[]): VehicleCardData | null {
  const shown = vehicles.filter((vehicle) => vehicle.status !== 'draft');
  return shown.find((vehicle) => vehicle.is_main) ?? shown[0] ?? null;
}

/**
 * The car's next due item from GAR-01's upcoming list (overdue first, then the nearest). `known` is false when the list was not
 * read, or when it is full (`limit`) without an item of this car: the car's next item may sit beyond the cut, so the widget
 * claims nothing.
 */
export function pickDue(
  t: TFunction<'garage'>,
  upcoming: readonly MaintenanceUpcoming[] | undefined,
  vehicleId: string,
  limit: number,
): { due: WidgetDue | null; known: boolean } {
  if (!upcoming) return { due: null, known: false };
  const own = sortItems(upcoming.filter((item) => item.vehicle_id === vehicleId && item.enabled));
  const next = own.find((item) => item.next_due.date !== null || item.next_due.km !== null) ?? null;
  if (!next) return { due: null, known: upcoming.length < limit };
  const days = numberOrNull(next.days_left);
  return {
    due: { title: itemTitle(t, next), days: days === null ? null : Math.round(days), km: numberOrNull(next.km_left), state: next.state },
    known: true,
  };
}

export type SnapshotInput = {
  member: string;
  locale: FormatLocale;
  unit: DistanceUnit;
  now: Date;
  car: VehicleCardData | null;
  photo: WidgetPhoto | null;
  due: { due: WidgetDue | null; known: boolean };
};

export function buildSnapshot(input: SnapshotInput): WidgetSnapshot {
  const { car } = input;
  return {
    v: SNAPSHOT_VERSION,
    member: input.member,
    locale: input.locale,
    unit: input.unit,
    day: berlinDay(input.now),
    car: car
      ? {
          id: car.id,
          name: car.title,
          eyebrow: car.eyebrow,
          photo: input.photo,
          due: input.due.due,
          dueKnown: input.due.known,
        }
      : null,
  };
}

/** Whole days from one Berlin day (YYYY-MM-DD) to another; both are calendar days, so no time zone moves them. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${to}T12:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** The due item as of `today`: the stored countdown moved on by the days since it was written. */
export function dueOn(due: WidgetDue, writtenOn: string, today: string): WidgetDue {
  if (due.days === null) return due;
  const days = due.days - Math.max(0, daysBetween(writtenOn, today));
  return { ...due, days, state: days < 0 ? 'overdue' : due.state };
}
