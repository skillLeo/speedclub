<?php

namespace App\Http\Resources\V1;

use App\Enums\BusinessKind;
use App\Enums\BusinessStatus;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Models\Business;
use App\Models\Media;
use App\Services\Businesses\BusinessListing;
use App\Services\Showcase\SampleContent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A BusinessCard (09 §5, ADR-457): cover 16:9 (with its fallback chain), logo 56, name, "Werkstatt · München", services chips, Verifiziert badge, distance when the list was asked
 * near a point. Never a count beyond the business's own portfolio, never a rating (09 §3.2: no fake reviews; there are no reviews).
 *
 * @property Business $resource
 */
class BusinessCardResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $business = $this->resource;
        $own = self::photo($business->cover);
        $fallback = $own === null ? self::photo($business->portfolioCover) : null;
        $cover = $own ?? $fallback;
        $source = $own !== null ? 'business' : ($fallback !== null ? 'portfolio' : null);
        $lat = $request->query('lat');
        $lng = $request->query('lng');

        return [
            'id' => $business->id,
            'slug' => $business->slug,
            'name' => $business->name,
            /** @var BusinessKind */
            'kind' => $business->kind,
            /** "Werkstatt" */
            'kind_label' => $business->kind->label(),
            'city' => $business->city,
            /** "Werkstatt · München" */
            'subline' => $business->kind->label().' · '.$business->city,
            /** @var list<string> */
            'services' => $business->services ?? [],
            'logo' => self::photo($business->logo),
            /**
             * ADR-457 (amends 09 §5 BusinessCard): the card's 16:9 media. The business's own cover, else the cover of its newest portfolio
             * build (real builds first; lists prepare it), else null: the client then shows a brand-stage photo, never a glyph tile.
             *
             * @var MediaResource|null
             */
            'cover' => $cover,
            /**
             * Where `cover` comes from: "business" (its own), "portfolio" (a build from "Builds aus unserer Werkstatt"), null when none.
             *
             * @var 'business'|'portfolio'|null
             */
            'cover_source' => $source,
            /**
             * Staff verified the business (ADM-55): the Verifiziert badge. Never on a sample (DQ-1144, 09 §8.19): a fictional business
             * carries the "Beispiel" badge alone.
             */
            'verified' => $business->status === BusinessStatus::Verified && ! SampleContent::isSample($business),
            /** Sample content (09 §8.19): the "Beispiel" badge. */
            'is_sample' => $business->is_sample,
            /**
             * Kilometres from `lat`/`lng` of the list request, else null.
             *
             * @var float|null
             */
            'distance_km' => is_numeric($lat) && is_numeric($lng) && $business->lat !== null && $business->lng !== null
                ? BusinessListing::distanceKm((float) $lat, (float) $lng, $business->lat, $business->lng) : null,
            /** "/b/beispiel-werkstatt-nord" */
            'share_path' => '/b/'.$business->slug,
        ];
    }

    public static function photo(?Media $media): ?MediaResource
    {
        return $media instanceof Media && $media->status === MediaStatus::Ready && $media->moderation_status !== ModerationStatus::Rejected ? new MediaResource($media) : null;
    }
}
