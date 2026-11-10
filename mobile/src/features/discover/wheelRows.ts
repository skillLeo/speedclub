import type { WheelSetup } from '@/api/queries/discover';
import { photoFields } from '@/features/profile/media';
import { formatNumber, type FormatLocale } from '@/lib/format';
import { size } from '@/theme';

import type { WheelTableRow } from './components/WheelSetupTable';
import { EMPTY_CELL, loweringCell, partCell, tyreCell, wheelSizeCell } from './wheelFormat';

type Axles = (front: string, rear: string) => string;
type Num = number | null | undefined;

const empty = (value: Num) => value === null || value === undefined;

/** One value where both axles match or only the front was given, else "… vorne · … hinten" (lead ruling, DQ-323). */
export function mergeAxles(front: string, rear: string | null, axles: Axles): string {
  if (rear === null || rear === EMPTY_CELL || rear === front) return front;
  if (front === EMPTY_CELL) return rear;
  return axles(front, rear);
}

/** "18″ × 9,5J": size without the offset, which has its own field. */
function sizeOf(diameter: Num, width: Num, locale: FormatLocale): string {
  return wheelSizeCell(diameter, width, null, locale);
}

function etOf(offset: Num, locale: FormatLocale): string {
  return empty(offset) ? EMPTY_CELL : `ET${formatNumber(offset as number, locale, { maxFractionDigits: 0 })}`;
}

/** "KW V3"; a suspension without a named part says what kind it is ("Gewindefahrwerk"). */
function suspensionCell(suspension: NonNullable<WheelSetup['suspension']>): string {
  const part = partCell(suspension.brand, suspension.model);
  return part === EMPTY_CELL && suspension.type_label ? suspension.type_label : part;
}

/**
 * One build of the DISC-04 comparison from the API's stored numbers (handover §7), formatted per §3.9, in the fixed order the
 * lead set: Felgen, Größe, ET, Reifen, Fahrwerk, Tieferlegung. A rear the owner left empty is the front (a square set, ADR-112).
 */
export function wheelTableRow(setup: WheelSetup, locale: FormatLocale, axles: Axles): WheelTableRow {
  const { vehicle, wheel, suspension } = setup;
  const square = empty(wheel.diameter_rear) && empty(wheel.width_rear) && empty(wheel.et_rear);
  const frontSize = sizeOf(wheel.diameter_front, wheel.width_front, locale);
  const rearSize = square ? null : sizeOf(wheel.diameter_rear ?? wheel.diameter_front, wheel.width_rear, locale);
  return {
    id: vehicle.id,
    slug: vehicle.slug,
    title: vehicle.full_title,
    owner: vehicle.owner ? `@${vehicle.owner.username}` : null,
    thumb: photoFields(vehicle.cover, size.avatar.md),
    cells: {
      wheel: partCell(wheel.brand, wheel.model),
      size: mergeAxles(frontSize, rearSize, axles),
      et: mergeAxles(etOf(wheel.et_front, locale), square ? null : etOf(wheel.et_rear, locale), axles),
      tyres: mergeAxles(tyreCell(wheel.tyre_front, locale), wheel.tyre_rear ? tyreCell(wheel.tyre_rear, locale) : null, axles),
      suspension: suspension ? suspensionCell(suspension) : EMPTY_CELL,
      lowering: suspension ? loweringCell(suspension.lowering_front, suspension.lowering_rear, locale) : EMPTY_CELL,
    },
  };
}
