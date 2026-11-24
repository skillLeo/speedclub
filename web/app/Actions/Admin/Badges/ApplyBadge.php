<?php

namespace App\Actions\Admin\Badges;

use App\Enums\GiftEvent;
use App\Jobs\Badges\ApplyBadgeSlice;
use App\Models\Badge;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Validation\ValidationException;

/**
 * Admin badge manager "Jetzt anwenden": queues the chunked award of one active badge to every member who reached it (ApplyBadgeSlice,
 * ≤ 50 s per slice, idempotent, no push). Atom `content.edit`, audited. Otherwise rule changes apply with the next nightly run.
 */
final class ApplyBadge
{
    public function handle(Staff $staff, Badge $badge): void
    {
        StaffAtoms::ensure($staff, 'content.edit');

        if (! $badge->active) {
            throw ValidationException::withMessages(['active' => [(string) __('validation.accepted', ['attribute' => 'active'])]]);
        }

        ApplyBadgeSlice::dispatch($badge->key);
        Audit::record(GiftEvent::BadgeApplied->value, $badge, null, ['rule_json' => $badge->rule_json], null, $staff);
    }
}
