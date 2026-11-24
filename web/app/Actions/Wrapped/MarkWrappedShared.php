<?php

namespace App\Actions\Wrapped;

use App\Models\User;
use App\Models\Wrapped;
use Illuminate\Support\Facades\Gate;

/**
 * POST me/wrapped/{season_key}/shared (m5.9e contract §5): `shared_count + 1` after the member shared a card. A plain counter for the
 * member's own Wrapped (no one else ever sees it); the route's Idempotency-Key keeps a retried request from counting twice.
 */
final class MarkWrappedShared
{
    public function __construct(private readonly FindMyWrapped $find) {}

    public function __invoke(User $member, string $seasonKey): Wrapped
    {
        $wrapped = ($this->find)($member, $seasonKey);
        Gate::forUser($member)->authorize('share', $wrapped);

        Wrapped::query()->whereKey($wrapped->id)->increment('shared_count');

        return $wrapped->refresh();
    }
}
