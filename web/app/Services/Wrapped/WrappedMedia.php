<?php

namespace App\Services\Wrapped;

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\ModStatus;
use App\Enums\PlateBlurState;
use App\Models\Media;
use App\Models\Modification;
use App\Models\Vehicle;
use App\Services\Media\MediaService;
use Illuminate\Database\Eloquent\Builder;

/**
 * Which photos a Wrapped may show (ADR-509, m5.9e contract §3): the member's own, finished, not rejected, not deleted photos whose plate
 * decision was made: `blurred` (pixelated into the master before any variant existed) or `declined` (the member said no plate is
 * visible). An `unchecked` photo (uploaded before M5.9a, still listed in "Kennzeichen prüfen") is never used. Only the public variants
 * leave the server, all made from the blurred master. Checked again on every read, so a photo deleted later disappears from the story.
 *
 * A car's photo (ADR-516 a: intro, Build Score, Build Spirit and share card) is chosen at generation from carPhotos() — the cover when
 * it may be shown, then the car's other photos that may — and read again by usableCarPhoto(), which also drops it once its car is
 * deleted.
 */
final class WrappedMedia
{
    public function __construct(private readonly MediaService $media) {}

    /**
     * @param  Builder<Media>  $query
     * @return Builder<Media>
     */
    public static function constrain(Builder $query, string $ownerId): Builder
    {
        return $query->where('owner_id', $ownerId)
            ->where('status', MediaStatus::Ready)
            ->where('moderation_status', '!=', ModerationStatus::Rejected)
            ->whereIn('plate_blur', [PlateBlurState::Blurred->value, PlateBlurState::Declined->value]);
    }

    public function usable(mixed $id, string $ownerId): ?Media
    {
        if (! is_string($id) || $id === '') {
            return null;
        }

        $media = self::constrain(Media::query(), $ownerId)->find($id);

        return $media instanceof Media && $this->media->variantUrls($media) !== [] ? $media : null;
    }

    /**
     * The usable photos of the member's car in the order Wrapped cards take them (ADR-516 a): the cover first when it may be shown, then
     * the car's other gallery photos that may, by sort order (then id), then the photos of its installed, not deleted mods (also the
     * member's own car), so a car with a short gallery still gives several cards a photo of its own. A photo with the blurhash of one
     * already listed is the same picture uploaded again (the demo's mod photos reuse the gallery shoot) and is left out. At most $limit.
     *
     * @return list<string> media ids
     */
    public function carPhotos(Vehicle $car, string $ownerId, int $limit = 6): array
    {
        $ids = [];
        $seen = [];
        $cover = $this->usable($car->getAttribute('cover_media_id'), $ownerId);

        if ($cover !== null) {
            $ids[] = (string) $cover->id;
            $seen[] = $cover->getAttribute('blurhash');
        }

        $photos = self::constrain(Media::query(), $ownerId)
            ->where('mediable_type', $car->getMorphClass())
            ->where('mediable_id', $car->id)
            ->when($cover !== null, fn (Builder $query) => $query->whereKeyNot($cover?->id))
            ->orderBy('sort')
            ->orderBy('id')
            ->limit($limit)
            ->get();

        $mods = self::constrain(Media::query(), $ownerId)
            ->where('mediable_type', (new Modification)->getMorphClass())
            // SF-2: installed mods only; a planned or removed part is often a product shot, not the member's car.
            ->whereIn('mediable_id', Modification::query()->select('id')->where('vehicle_id', $car->id)->where('status', ModStatus::Installed->value))
            ->orderBy('sort')
            ->orderBy('id')
            ->limit($limit)
            ->get();

        foreach ([...$photos, ...$mods] as $photo) {
            $hash = $photo->getAttribute('blurhash');
            $again = is_string($hash) && $hash !== '' && in_array($hash, $seen, true);

            if (count($ids) < $limit && ! $again && ! in_array((string) $photo->id, $ids, true) && $this->media->variantUrls($photo) !== []) {
                $ids[] = (string) $photo->id;
                $seen[] = $hash;
            }
        }

        return $ids;
    }

    /**
     * A stored car photo read again: usable(), and what it hangs on still stands: a gallery photo's car is the member's and not deleted;
     * a mod photo's mod is not deleted and sits on such a car (SF-1: a photo row a partial cleanup left behind never shows). Anything
     * else is no car photo.
     */
    public function usableCarPhoto(mixed $id, string $ownerId): ?Media
    {
        $media = $this->usable($id, $ownerId);

        if ($media === null) {
            return null;
        }

        $type = $media->getAttribute('mediable_type');
        $parent = $media->getAttribute('mediable_id');
        // Vehicle::query() leaves soft-deleted cars out.
        $ownCars = Vehicle::query()->select('id')->where('owner_id', $ownerId);

        $stands = match ($type) {
            (new Vehicle)->getMorphClass() => Vehicle::query()->where('owner_id', $ownerId)->whereKey($parent)->exists(),
            (new Modification)->getMorphClass() => Modification::query()->whereKey($parent)->whereIn('vehicle_id', $ownCars)->exists(),
            default => false,
        };

        return $stands ? $media : null;
    }

    /**
     * The photo as the app reads it (mobile/src/api/queries/wrapped.ts parseWrappedPhoto): the variants by width, the hashes and the
     * focal point.
     *
     * @return array{url: string, variants: list<array{width: int, url: string}>, blurhash: string|null, thumbhash: string|null, focal_x: float|null, focal_y: float|null}|null
     */
    public function present(?Media $media): ?array
    {
        if ($media === null) {
            return null;
        }

        $urls = $this->media->variantUrls($media);

        if ($urls === []) {
            return null;
        }

        $variants = [];

        foreach ($urls as $width => $url) {
            $variants[] = ['width' => $width, 'url' => $url];
        }

        $preferred = array_values(array_filter($variants, fn (array $variant): bool => $variant['width'] >= 1080))[0] ?? end($variants);
        $blurhash = $media->getAttribute('blurhash');
        $thumbhash = $media->getAttribute('thumbhash');
        $focalX = $media->getAttribute('focal_x');
        $focalY = $media->getAttribute('focal_y');

        return [
            'url' => $preferred['url'],
            'variants' => $variants,
            'blurhash' => is_string($blurhash) ? $blurhash : null,
            'thumbhash' => is_string($thumbhash) ? $thumbhash : null,
            'focal_x' => is_numeric($focalX) ? (float) $focalX : null,
            'focal_y' => is_numeric($focalY) ? (float) $focalY : null,
        ];
    }
}
