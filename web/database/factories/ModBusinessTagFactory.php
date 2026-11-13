<?php

namespace Database\Factories;

use App\Enums\ModTagInitiator;
use App\Enums\ModTagStatus;
use App\Models\Business;
use App\Models\ModBusinessTag;
use App\Models\Modification;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A pending tag the build's owner asked for.
 *
 * @extends Factory<ModBusinessTag>
 */
class ModBusinessTagFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'mod_id' => Modification::factory(),
            'business_id' => Business::factory(),
            'status' => ModTagStatus::Pending,
            'initiated_by' => ModTagInitiator::Member,
            'requested_by' => null,
        ];
    }
}
