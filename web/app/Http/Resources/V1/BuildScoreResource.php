<?php

namespace App\Http\Resources\V1;

use App\Services\BuildScore\BuildScores;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * M5.9c (m5.9c contract §4): one vehicle's Build Score — 0 to 1000 from what is shown and documented, never from power, speed, sound
 * or money.
 *
 * @phpstan-import-type Read from BuildScores
 *
 * @property Read $resource
 */
class BuildScoreResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $score = $this->resource;

        return [
            /**
             * 0–1000.
             *
             * @var int
             */
            'total' => $score['total'],
            /**
             * 1 (0–199) to 5 (800+).
             *
             * @var int
             */
            'stage' => $score['stage'],
            /**
             * Owner only: the four parts with their caps. A visitor never gets them (the community part is mostly 2 points per
             * reacting member, and reaction counts are private).
             *
             * @var array{completeness: array{points: int, max: int}, documentation: array{points: int, max: int}, community: array{points: int, max: int}, journey: array{points: int, max: int}}
             */
            'parts' => $this->when(array_key_exists('parts', $score), fn (): array => $score['parts'] ?? []),
            /**
             * Generation first ("#4 von 61 EK9 in Deutschland"), then the owner's Bundesland ("#2 in NRW"); only groups of at least 3
             * public cars, computed nightly. Empty for a private, ghost or sample car.
             *
             * @var list<array{scope: 'generation'|'bundesland', label: string, rank: int, group_size: int, region: string|null}>
             */
            'ranks' => $score['ranks'],
            /** @var string|null */
            'computed_at' => $score['computed_at'],
            /**
             * Owner only: the total before the last change, for "+25"; null before the first change. A visitor never gets it (one
             * step of 2 or 1 points is a single new reaction, spotter or follower).
             *
             * @var int|null
             */
            'previous_total' => $this->when(array_key_exists('previous_total', $score), fn (): ?int => $score['previous_total'] ?? null),
            /**
             * Owner only, most points first: what can still be added. Keys photos, key_specs, description, cover_focal, documented_mods,
             * planned_mods, registered_mods, timeline, before_after; progress need − have is what is missing (description: characters).
             *
             * @var list<array{key: string, label_key: string, points: int, progress: array{have: int, need: int}}>
             */
            'next_upgrades' => $this->when(array_key_exists('next_upgrades', $score), fn (): array => $score['next_upgrades'] ?? []),
            /** @var string */
            'formula_version' => $score['formula_version'],
        ];
    }
}
