<?php

namespace App\Actions\Media;

use App\Models\User;

/**
 * M5.9a "Später" on the garage card (m5.9a-contract §4): the card ends for good. The first time counts; repeating it changes nothing.
 */
class DismissPlateCheck
{
    public function handle(User $member): void
    {
        User::query()->whereKey($member->getKey())
            ->whereNull('plate_check_dismissed_at')
            ->update(['plate_check_dismissed_at' => now()]);
    }
}
