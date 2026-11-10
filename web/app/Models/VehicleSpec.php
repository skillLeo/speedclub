<?php

namespace App\Models;

use App\Enums\Aspiration;
use App\Enums\Drivetrain;
use App\Enums\Fuel;
use App\Enums\Gearbox;
use App\Enums\PowerSource;
use App\Enums\PowerUnit;
use App\Support\Units;
use Database\Factories\VehicleSpecFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * power_value and power_unit hold exactly what the member entered. Change power only through setPower(),
 * which keeps the normalised power_ps in step.
 *
 * @property string $vehicle_id
 * @property float|null $power_value
 * @property PowerUnit|null $power_unit
 * @property PowerSource|null $power_source
 * @property float|null $power_ps
 */
#[Table(key: 'vehicle_id', keyType: 'string', incrementing: false)]
#[Fillable([
    'vehicle_id', 'engine_code', 'engine_text', 'displacement_cc', 'fuel', 'aspiration', 'torque_nm', 'torque_source',
    'drivetrain', 'gearbox',
])]
class VehicleSpec extends Model
{
    /** @use HasFactory<VehicleSpecFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'displacement_cc' => 'integer',
            'fuel' => Fuel::class,
            'aspiration' => Aspiration::class,
            'power_value' => 'float',
            'power_unit' => PowerUnit::class,
            'power_source' => PowerSource::class,
            'power_ps' => 'float',
            'torque_nm' => 'integer',
            'torque_source' => PowerSource::class,
            'drivetrain' => Drivetrain::class,
            'gearbox' => Gearbox::class,
        ];
    }

    public function setPower(float|int|null $value, ?PowerUnit $unit, ?PowerSource $source = null): static
    {
        $complete = $value !== null && $unit !== null;

        return $this->forceFill([
            'power_value' => $complete ? $value : null,
            'power_unit' => $complete ? $unit : null,
            'power_source' => $complete ? $source : null,
            'power_ps' => $complete ? Units::toPs($value, $unit) : null,
        ]);
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }
}
