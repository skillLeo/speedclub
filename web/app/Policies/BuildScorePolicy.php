<?php

namespace App\Policies;

use App\Models\BuildScore;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * M5.9c: a Build Score is seen wherever its vehicle is (GET vehicles/{id}/build-score; `next_upgrades` only for the owner).
 */
class BuildScorePolicy
{
    public function view(?User $user, BuildScore $score): bool
    {
        $vehicle = $score->vehicle;

        return $vehicle !== null && Gate::forUser($user)->allows('view', $vehicle);
    }
}
