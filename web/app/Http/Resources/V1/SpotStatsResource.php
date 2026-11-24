<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * DEX-06 / INS-01 (m5.9b contract §4): the owner's spot numbers of one car (App\Services\Dex\OwnerSpotStats). Owner only.
 *
 * @property array{total: int, unique_spotters: int, cities_count: int, cities: list<array{name: string, count: int}>, last_30_days: list<array{day: string, count: int}>, recent_spotters: list<array{username: string, display_name: string|null, avatar: array{url: string, thumbhash: string|null}|null}|array{anonymous: true}>, street_famous: array{tier: int|null}} $resource
 */
class SpotStatsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $stats = $this->resource;

        return [
            /**
             * Counted spots.
             *
             * @var int
             */
            'total' => $stats['total'],
            /** @var int */
            'unique_spotters' => $stats['unique_spotters'],
            /**
             * Cities of day spots; 0 while the owner hides the cities.
             *
             * @var int
             */
            'cities_count' => $stats['cities_count'],
            /**
             * Day spots only, most spotted first, at most 20; empty while the owner hides the cities.
             *
             * @var list<array{name: string, count: int}>
             */
            'cities' => $stats['cities'],
            /**
             * One entry per day (Europe/Berlin), oldest first, zeros included. Only spots older than the owner alert's 3 hours count here
             * (nothing live), so today's bucket and `total` can differ for a while.
             *
             * @var list<array{day: string, count: int}>
             */
            'last_30_days' => $stats['last_30_days'],
            /**
             * Newest first, only spots older than the owner alert's 3 hours (nothing live). `{anonymous: true}` ("jemand") for a spotter
             * who keeps "Meine Spots zeigen" off.
             *
             * @var list<array{username: string, display_name: string|null, avatar: array{url: string, thumbhash: string|null}|null}|array{anonymous: true}>
             */
            'recent_spotters' => $stats['recent_spotters'],
            /**
             * "Street Famous": 10, 50, 100 or 500 unique spotters reached, else null.
             *
             * @var array{tier: 10|50|100|500|null}
             */
            'street_famous' => $stats['street_famous'],
        ];
    }
}
