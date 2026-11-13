<?php

namespace App\Actions\Social;

use App\Enums\ReactableType;
use App\Models\Reaction;
use App\Models\User;

/**
 * Takes the member's reaction back, by id alone: whatever state the item is in now, the answer is the same.
 */
class Unreact
{
    public function handle(User $user, ReactableType $type, string $id): void
    {
        Reaction::query()->where('user_id', $user->id)->where('reactable_type', $type->morph())->where('reactable_id', strtolower($id))->delete();
    }
}
