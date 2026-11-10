<?php

namespace Database\Factories;

use App\Enums\Aspiration;
use App\Enums\Drivetrain;
use App\Enums\Fuel;
use App\Enums\Gearbox;
use App\Enums\PowerSource;
use App\Enums\PowerUnit;
use App\Models\Vehicle;
use App\Models\VehicleSpec;
use App\Support\Units;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<VehicleSpec>
 */
class VehicleSpecFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $power = fake()->numberBetween(90, 700);
        $unit = fake()->randomElement(PowerUnit::cases());

        return [
            'vehicle_id' => Vehicle::factory(),
            'engine_code' => 'S58',
            'engine_text' => '3,0 l R6 Biturbo',
            'displacement_cc' => 2993,
            'fuel' => Fuel::Petrol,
            'aspiration' => Aspiration::Biturbo,
            'power_value' => $power,
            'power_unit' => $unit,
            'power_source' => PowerSource::Factory,
            'power_ps' => Units::toPs($power, $unit),
            'torque_nm' => 650,
            'torque_source' => PowerSource::Factory,
            'drivetrain' => Drivetrain::Rear,
            'gearbox' => Gearbox::Automatic,
        ];
    }
}
