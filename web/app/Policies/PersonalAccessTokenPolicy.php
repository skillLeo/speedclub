<?php

namespace App\Policies;

use App\Models\PersonalAccessToken;
use App\Models\User;

class PersonalAccessTokenPolicy
{
    public function viewAny(User $user): bool
    {
        return ! $user->isDeactivated();
    }

    public function view(User $user, PersonalAccessToken $token): bool
    {
        return $this->owns($user, $token);
    }

    public function delete(User $user, PersonalAccessToken $token): bool
    {
        return $this->owns($user, $token);
    }

    private function owns(User $user, PersonalAccessToken $token): bool
    {
        return $token->tokenable_type === $user->getMorphClass() && $token->tokenable_id === $user->id;
    }
}
