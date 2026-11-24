<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * "So entsteht dein Build Score" (m5.9c contract §4): config/speedclub.php `build_score`.
 *
 * @property array{max: int, stages: list<array{stage: int, min: int}>, parts: list<array{key: string, max: int, items: list<array{key: string, points: int, limit: int|null, max: int, min_chars?: int}>}>, formula_version: string} $resource
 */
class BuildScoreFormulaResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /**
             * 1000.
             *
             * @var int
             */
            'max' => $this->resource['max'],
            /**
             * Stage 1–5 and the score each starts at.
             *
             * @var list<array{stage: int, min: int}>
             */
            'stages' => $this->resource['stages'],
            /**
             * completeness, documentation, community, journey. Each item gives `points` per unit for at most `limit` units (null: once),
             * capped at `max`; `description` needs `min_chars` characters.
             *
             * @var list<array{key: 'completeness'|'documentation'|'community'|'journey', max: int, items: list<array{key: string, points: int, limit: int|null, max: int, min_chars?: int}>}>
             */
            'parts' => $this->resource['parts'],
            /** @var string */
            'formula_version' => $this->resource['formula_version'],
        ];
    }
}
