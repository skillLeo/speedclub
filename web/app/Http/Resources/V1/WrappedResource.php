<?php

namespace App\Http\Resources\V1;

use App\Models\Wrapped;
use App\Services\Wrapped\WrappedPresenter;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * GET me/wrapped/{season_key} (m5.9e contract §3): the member's season story, version 1. Only the member's own data; city names only;
 * photos are the public variants of blurred masters; no other member is named. Words in the request's language. `cards` keep their
 * order and count, so `cards/{n}.png` names position n. A card is one of:
 *
 * - `{kind: "intro", title, subtitle, image: Photo|null}` (the lead car, the one the share card shows; ADR-516 a)
 * - `{kind: "spots", count, unique_cars, cities: string[] (≤ 5, day spots), rarest: {dex_number, rarity, vehicle_name, make, generation}|null}`
 * - `{kind: "scans", sticker_scans, profile_or_vehicle_views: null, top_city: string|null}`
 * - `{kind: "score", from, to, stage_from, stage_to, vehicle_name, image: Photo|null}` (the score car)
 * - `{kind: "top_mod", name, brand, before_media: Photo|null, after_media: Photo|null, vehicle_name}`
 * - `{kind: "treffen", attended, names: string[] (≤ 3 public meet titles)}`
 * - `{kind: "build_spirit", key, title, explanation, image: Photo|null}` (the car whose mods decide the spirit)
 * - `{kind: "percentile", bundesland, percentile ("Top 12 %"), metric: "build_score"}`
 * - `{kind: "share", vehicle_name, dex_number, score, stage, qr_url (/v/{slug} of the car's public page, never the sticker code; ADR-514)|null, qr_svg (that address as a QR, SVG)|null, image: Photo|null}`
 *
 * Photo = `{url, variants: [{width, url}], blurhash, thumbhash, focal_x, focal_y}`: always a photo of the member's own car or mod, never
 * another member's (the spots and Treffen cards have none, ADR-516 a).
 *
 * @property Wrapped $resource
 */
class WrappedResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $payload = app(WrappedPresenter::class)->present($this->resource);

        return [
            /** @var int */
            'v' => $payload['v'],
            'season_key' => $payload['season_key'],
            /** @var array{from: string, to: string} */
            'window' => $payload['window'],
            /** @var array{display_name: string|null, username: string|null, avatar: array{url: string, thumbhash: string|null}|null} */
            'member' => $payload['member'],
            /**
             * The story cards in their stored order (`cards/{n}.png` = position n), told apart by `kind`; `image` on intro, score and
             * build_spirit is a photo of the member's own car (ADR-516 a), null without a usable one.
             *
             * @var list<array{kind: 'intro', title: string, subtitle: string, image: array{url: string, variants: list<array{width: int, url: string}>, blurhash: string|null, thumbhash: string|null, focal_x: float|null, focal_y: float|null}|null}|array{kind: 'spots', count: int, unique_cars: int, cities: list<string>, rarest: array{dex_number: int|null, rarity: string, vehicle_name: string, make: string|null, generation: string|null}|null}|array{kind: 'scans', sticker_scans: int, profile_or_vehicle_views: int|null, top_city: string|null}|array{kind: 'score', from: int, to: int, stage_from: int, stage_to: int, vehicle_name: string, image: array{url: string, variants: list<array{width: int, url: string}>, blurhash: string|null, thumbhash: string|null, focal_x: float|null, focal_y: float|null}|null}|array{kind: 'top_mod', name: string, brand: string|null, before_media: array{url: string, variants: list<array{width: int, url: string}>, blurhash: string|null, thumbhash: string|null, focal_x: float|null, focal_y: float|null}|null, after_media: array{url: string, variants: list<array{width: int, url: string}>, blurhash: string|null, thumbhash: string|null, focal_x: float|null, focal_y: float|null}|null, vehicle_name: string}|array{kind: 'treffen', attended: int, names: list<string>}|array{kind: 'build_spirit', key: string, title: string, explanation: string, image: array{url: string, variants: list<array{width: int, url: string}>, blurhash: string|null, thumbhash: string|null, focal_x: float|null, focal_y: float|null}|null}|array{kind: 'percentile', bundesland: string, percentile: string, metric: 'build_score'}|array{kind: 'share', vehicle_name: string, dex_number: int|null, score: int|null, stage: int|null, qr_url: string|null, qr_svg: string|null, image: array{url: string, variants: list<array{width: int, url: string}>, blurhash: string|null, thumbhash: string|null, focal_x: float|null, focal_y: float|null}|null}>
             */
            'cards' => $payload['cards'],
            /** Only for the staging demo of a sample member: every card shows "Beispiel". */
            'is_sample' => $this->when($this->resource->is_sample, true),
        ];
    }
}
