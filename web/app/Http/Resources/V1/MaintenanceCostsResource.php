<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Private cost totals of a vehicle (owner only), euro cents.
 *
 * @property array{currency: string, total_cents: int, maintenance_cents: int, mods_cents: int, years: list<array{year: int, total_cents: int, maintenance_cents: int, mods_cents: int}>} $resource
 */
class MaintenanceCostsResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $costs = $this->resource;

        return [
            /** Always "EUR": the server keeps euro cents. */
            'currency' => $costs['currency'],
            /** @var int */
            'total_cents' => $costs['total_cents'],
            /** @var int */
            'maintenance_cents' => $costs['maintenance_cents'],
            /** @var int */
            'mods_cents' => $costs['mods_cents'],
            /**
             * Newest year first; only years with a cost.
             *
             * @var list<array{year: int, total_cents: int, maintenance_cents: int, mods_cents: int}>
             */
            'years' => $costs['years'],
        ];
    }
}
