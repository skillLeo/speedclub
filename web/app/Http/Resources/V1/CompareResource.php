<?php

namespace App\Http\Resources\V1;

use App\Models\Modification;
use App\Models\Vehicle;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * VEH-06 [SIG sig.compare]: two builds side by side (CompareBuilds).
 *
 * @property array{a: Vehicle, b: Vehicle, specs: list<array{key: string, label: string, rows: list<array{key: string, label: string, a: string|null, b: string|null, differs: bool}>}>, mods: list<array{key: string, label: string, icon: string|null, a: list<Modification>, b: list<Modification>}>} $resource
 */
class CompareResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** The first build as a card: slug, full_title, subline_parts, cover, spec_strip. */
            'a' => new VehicleCardResource($this->resource['a']),
            'b' => new VehicleCardResource($this->resource['b']),
            /**
             * The Technik tables of both, merged: Fahrzeug, Motor, Leistung, Antrieb. A row is there when either build has a value (the other
             * side is then null); `differs` when the two values are not the same text, ignoring case and spacing.
             *
             * @var list<array{key: string, label: string, rows: list<array{key: string, label: string, a: string|null, b: string|null, differs: bool}>}>
             */
            'specs' => $this->resource['specs'],
            /**
             * Every mod category either build has, in the catalogue's order, each side with its mods in the owner's order (empty when that
             * build has none in it).
             *
             * @var list<array{key: string, label: string, icon: string|null, a: list<ModificationRowResource>, b: list<ModificationRowResource>}>
             */
            'mods' => array_map(fn (array $category): array => [
                'key' => $category['key'],
                'label' => $category['label'],
                'icon' => $category['icon'],
                'a' => array_map(fn (Modification $mod): ModificationRowResource => new ModificationRowResource($mod), $category['a']),
                'b' => array_map(fn (Modification $mod): ModificationRowResource => new ModificationRowResource($mod), $category['b']),
            ], $this->resource['mods']),
        ];
    }
}
