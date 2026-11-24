<?php

namespace App\Policies;

use App\Models\CarOfTheDayCandidate;
use App\Models\User;

/**
 * R4-2.1: a candidate is read only inside the vote round (CarOfTheDayVoting::state applies the reader's visibility, CarOfTheDayVotePolicy
 * the access); members never write one, the 18:00 freeze does. Staff read the tally through CarOfTheDayVotes.
 */
class CarOfTheDayCandidatePolicy
{
    public function view(User $user, CarOfTheDayCandidate $candidate): bool
    {
        return ! $user->isDeactivated();
    }
}
