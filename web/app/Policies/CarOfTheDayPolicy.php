<?php

namespace App\Policies;

use App\Models\CarOfTheDay;
use App\Models\User;

/**
 * M5.9d: the Car of the Day is shown through Home (CarOfTheDays::shownTo, which applies the reader's visibility); the owner edits the
 * story line through VehiclePolicy::update; staff decide through the admin actions (atom content.edit).
 */
class CarOfTheDayPolicy
{
    public function view(?User $user, CarOfTheDay $pick): bool
    {
        return $pick->published_at !== null && ! $pick->skipped;
    }
}
