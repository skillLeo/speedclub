<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * "So funktioniert Seltenheit" (m5.9b contract §3, §10): the thresholds of config/speedclub.php `dex.rarity`.
 *
 * @property array{tuned: array{min_build_score: int}, rare: array{max_same_generation: int}, legend: array{min_build_score: int, unique_generation: bool}, ghost: array{opt_in: bool}} $resource
 */
class RarityRulesResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /**
             * Tuned: Build Score at least.
             *
             * @var array{min_build_score: int}
             */
            'tuned' => $this->resource['tuned'],
            /**
             * Rare: at most this many public cars of the same generation.
             *
             * @var array{max_same_generation: int}
             */
            'rare' => $this->resource['rare'],
            /**
             * Legend: Build Score at least, or the only public car of its generation.
             *
             * @var array{min_build_score: int, unique_generation: bool}
             */
            'legend' => $this->resource['legend'],
            /**
             * Ghost: the owner's opt-in.
             *
             * @var array{opt_in: bool}
             */
            'ghost' => $this->resource['ghost'],
        ];
    }
}
