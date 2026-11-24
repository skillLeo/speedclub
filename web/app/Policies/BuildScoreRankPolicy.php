<?php

namespace App\Policies;

use App\Models\BuildScoreRank;
use App\Models\User;
use Illuminate\Support\Facades\Gate;

/**
 * M5.9c: a rank line is seen wherever its vehicle is; BuildScores::ranks() also hides it while the car may not be ranked.
 */
class BuildScoreRankPolicy
{
    public function view(?User $user, BuildScoreRank $rank): bool
    {
        $vehicle = $rank->vehicle;

        return $vehicle !== null && Gate::forUser($user)->allows('view', $vehicle);
    }
}
