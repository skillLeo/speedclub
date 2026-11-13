import { PixelRatio } from 'react-native';

import type { MediaData, VehicleCardData } from '@/api/queries/profile';
import { keepNameTogether } from '@/lib/format';
import type { PhotoFields, VehicleCardProps } from '@/ui';

/** The smallest variant that fills `width` points on this screen, or the largest there is. */
export function variantUrl(media: MediaData | null | undefined, width: number, pixelRatio: number = PixelRatio.get()): string | null {
  const variants = [...(media?.variants ?? [])].sort((a, b) => a.width - b.width);
  const needed = Math.ceil(width * pixelRatio);
  return (variants.find((variant) => variant.width >= needed) ?? variants[variants.length - 1])?.url ?? null;
}

/** What `Photo` needs: the variant, the blurhash and the focal point set in GAR-08 (§7). */
export function photoFields(media: MediaData | null | undefined, width: number): PhotoFields {
  if (!media) return { source: null };
  const focal = media.focal_x !== null && media.focal_y !== null ? { x: media.focal_x, y: media.focal_y } : null;
  return { source: variantUrl(media, width), blurhash: media.blurhash, thumbhash: media.thumbhash, focal };
}

/** The chips of §8: power and torque with their unit, then the drivetrain. Values not entered yet stay out. */
const CHIP_KEYS = ['power', 'torque', 'drivetrain'];

export function specChips(vehicle: Pick<VehicleCardData, 'spec_strip'>): string[] {
  return CHIP_KEYS.flatMap((key) => {
    const item = vehicle.spec_strip.find((entry) => entry.key === key);
    if (!item?.value) return [];
    return [item.unit ? `${item.value} ${item.unit}` : item.value];
  });
}

/** "Nissan Skyline GT-R R34", "2002 · 2,6 l R6 Biturbo (RB26DETT)" and the rest of a card. */
export function vehicleCardProps(
  vehicle: VehicleCardData,
  width: number,
): Pick<VehicleCardProps, 'title' | 'subtitle' | 'photo' | 'specs' | 'isMain' | 'sample'> {
  return {
    // DQ-147, DQ-047: the name wraps at its spaces, never inside "GT-R".
    title: keepNameTogether(vehicle.full_title),
    subtitle: vehicle.subline_parts.slice(0, 2).join(' · ') || undefined,
    photo: photoFields(vehicle.cover, width),
    specs: specChips(vehicle),
    isMain: vehicle.is_main,
    // 09 §8.19: the Beispiel badge on every sample build.
    sample: { is_sample: vehicle.is_sample },
  };
}

/** What the profile shows: published vehicles, as the Fahrzeuge count does. Drafts and archived ones stay in the Garage tab. */
export function profileVehicles(vehicles: readonly VehicleCardData[] | undefined): VehicleCardData[] {
  return (vehicles ?? []).filter((vehicle) => vehicle.status === 'published');
}
