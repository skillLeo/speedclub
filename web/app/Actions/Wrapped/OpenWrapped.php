<?php

namespace App\Actions\Wrapped;

use App\Models\User;
use App\Models\Wrapped;
use App\Support\ViewAs;

/**
 * GET me/wrapped/{season_key} (m5.9e contract §5): the released Wrapped, and the first time the member opens it `viewed_at` is set.
 * Staff in view-as read it without marking it seen (SEC-P5-11: a GET in view-as changes nothing of the member's).
 */
final class OpenWrapped
{
    public function __construct(private readonly FindMyWrapped $find) {}

    public function __invoke(User $member, string $seasonKey): Wrapped
    {
        $wrapped = ($this->find)($member, $seasonKey);

        if ($wrapped->viewed_at === null && ! ViewAs::active()) {
            Wrapped::query()->whereKey($wrapped->id)->whereNull('viewed_at')->update(['viewed_at' => now()]);
            $wrapped->viewed_at = now();
        }

        return $wrapped;
    }
}
