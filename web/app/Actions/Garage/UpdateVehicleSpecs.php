<?php

namespace App\Actions\Garage;

use App\Enums\PowerSource;
use App\Enums\PowerUnit;
use App\Models\Vehicle;
use App\Models\VehicleSpec;
use App\Services\Garage\BuildUpdates;
use App\Services\PublicPages\OgImages;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;

/**
 * PUT: what is not sent is empty afterwards. Power goes through VehicleSpec::setPower, which stores what was entered and keeps
 * the normalised power_ps in step.
 */
class UpdateVehicleSpecs
{
    public function __construct(
        private readonly BuildUpdates $updates,
        private readonly VehicleSearchProjector $search,
        private readonly OgImages $og,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     * @return bool whether Verlauf now tells about this save. Nothing to tell: the same values, a draft, a torque source (not part of
     *              the history), the same power in another unit, a value changed back within the window.
     */
    public function handle(Vehicle $vehicle, array $attributes): bool
    {
        return DB::transaction(function () use ($vehicle, $attributes): bool {
            // The vehicle's row, as the first save has no specs row to lock: two parallel first saves would both insert.
            Vehicle::query()->whereKey($vehicle->id)->lockForUpdate()->firstOrFail();

            $specs = VehicleSpec::query()->find($vehicle->id) ?? new VehicleSpec(['vehicle_id' => $vehicle->id]);
            $before = $this->snapshot($specs);

            $torque = $attributes['torque_nm'] ?? null;

            $specs->fill([
                'engine_code' => $attributes['engine_code'] ?? null,
                'engine_text' => $attributes['engine_text'] ?? null,
                'displacement_cc' => $attributes['displacement_cc'] ?? null,
                'fuel' => $attributes['fuel'] ?? null,
                'aspiration' => $attributes['aspiration'] ?? null,
                'torque_nm' => $torque,
                'torque_source' => $torque === null ? null : ($attributes['torque_source'] ?? null),
                'drivetrain' => $attributes['drivetrain'] ?? null,
                'gearbox' => $attributes['gearbox'] ?? null,
            ]);

            $value = $attributes['power_value'] ?? null;
            $unit = $attributes['power_unit'] ?? null;
            $source = $attributes['power_source'] ?? null;

            $specs->setPower(
                is_numeric($value) ? (float) $value : null,
                is_string($unit) ? PowerUnit::from($unit) : null,
                is_string($source) ? PowerSource::from($source) : null,
            );
            $specs->save();

            if (! $specs->wasRecentlyCreated && ! $specs->wasChanged()) {
                return false;
            }

            $recorded = $this->updates->specsChanged($vehicle, $before, $this->snapshot($specs));
            $this->search->changed($vehicle);
            $this->og->queue($vehicle);

            return $recorded;
        });
    }

    /**
     * Plain values, for comparing and for the history. The source belongs to the power: a dyno run changes it.
     *
     * @return array<string, mixed>
     */
    private function snapshot(VehicleSpec $specs): array
    {
        $enum = fn (string $key): mixed => $specs->getAttribute($key)?->value;

        return [
            'engine_code' => $specs->getAttribute('engine_code'),
            'engine_text' => $specs->getAttribute('engine_text'),
            'displacement_cc' => $specs->getAttribute('displacement_cc'),
            'fuel' => $enum('fuel'),
            'aspiration' => $enum('aspiration'),
            'power' => $specs->power_value === null ? null : [
                'value' => (float) $specs->power_value,
                'unit' => $specs->power_unit?->value,
                'source' => $specs->power_source?->value,
            ],
            'torque_nm' => $specs->getAttribute('torque_nm'),
            'drivetrain' => $enum('drivetrain'),
            'gearbox' => $enum('gearbox'),
        ];
    }
}
