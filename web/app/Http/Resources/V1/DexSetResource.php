<?php

namespace App\Http\Resources\V1;

use App\Services\Dex\SetView;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One set of DEX-05 (m5.9b contract §3, §10). A found slot is a full SpotCard; an unfound slot of a JDM set names make and generation
 * ("???" with a hint), any other unfound slot is blank. A ghost car is never named in a slot it did not fill.
 *
 * @property SetView $resource
 */
class DexSetResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $view = $this->resource;
        $set = $view->set;

        return [
            'key' => $set->key,
            'name' => $set->name(),
            'kind' => $set->kind,
            'progress' => $view->progress,
            'target' => $view->target,
            'completed_at' => $view->completedAt?->toIso8601String(),
            /**
             * Season sets: the month-day window, every year again; null for the others.
             *
             * @var array{starts_on: string, ends_on: string}|null
             */
            'window' => $set->starts_on !== null && $set->ends_on !== null ? ['starts_on' => $set->starts_on, 'ends_on' => $set->ends_on] : null,
            /**
             * @var list<array{found: bool, vehicle: SpotCardResource|null, silhouette: array{make: string|null, generation: string|null}|null}>
             */
            'slots' => array_map(fn (array $slot): array => [
                'found' => $slot['found'],
                'vehicle' => $slot['card'] === null ? null : new SpotCardResource($slot['card']),
                'silhouette' => $slot['silhouette'],
            ], $view->slots),
        ];
    }
}
