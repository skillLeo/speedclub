<?php

namespace App\Http\Requests\Api\V1\Garage;

use App\Models\Vehicle;
use App\Services\Garage\BuildGoal;
use Closure;

/**
 * PATCH vehicles/{id}: the fields of POST vehicles plus the owner's STREET DEX switches (m5.9b contract §5). A class of its own, so the
 * OpenAPI export lists the switches for PATCH only (Scramble shares one schema per request class).
 */
class UpdateVehicleRequest extends VehicleAttributesRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            ...parent::rules(),
            /** M5.9b: out of every list, search and the sitemap; still reachable by link and sticker. */
            'ghost_mode' => ['sometimes', 'required', 'boolean:strict'],
            /** M5.9b: new spots of this car are refused. */
            'spotting_paused' => ['sometimes', 'required', 'boolean:strict'],
            /** M5.9b: the owner's spot numbers name no city. */
            'hide_spot_cities' => ['sometimes', 'required', 'boolean:strict'],
            /**
             * M5.7: the optional milestone goal "Ziel: Saison 2027" (a year from now to ten years ahead; the stored value may be sent
             * again unchanged after its year). Null clears it.
             */
            'build_goal_season' => ['sometimes', 'nullable', 'integer', function (string $attribute, mixed $value, Closure $fail): void {
                $vehicle = $this->route('vehicle');
                $stored = $vehicle instanceof Vehicle ? $vehicle->getAttribute('build_goal_season') : null;
                $min = BuildGoal::currentYear();
                $max = $min + BuildGoal::MAX_YEARS_AHEAD;

                if ($value !== $stored && ((int) $value < $min || (int) $value > $max)) {
                    $fail((string) __('garage.build_goal_range', ['min' => $min, 'max' => $max]));
                }
            }],
        ];
    }
}
