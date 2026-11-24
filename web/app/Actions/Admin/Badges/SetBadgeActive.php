<?php

namespace App\Actions\Admin\Badges;

use App\Enums\GiftEvent;
use App\Models\Badge;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Badges\BadgeRules;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Admin badge manager: activates or deactivates a badge (atom `content.edit`, audited). An inactive badge is awarded to nobody and
 * leaves GET me/badges; members who earned it keep the row (it shows again once it is active). A badge whose stored rule no longer
 * validates (a removed metric such as `night_spots`, ADR-516 b, or a removed set) cannot be switched on: 422 on `active`.
 */
final class SetBadgeActive
{
    public function handle(Staff $staff, Badge $badge, bool $active, ?string $reason = null): Badge
    {
        StaffAtoms::ensure($staff, 'content.edit');

        return DB::transaction(function () use ($staff, $badge, $active, $reason): Badge {
            $locked = Badge::query()->whereKey($badge->key)->lockForUpdate()->firstOrFail();

            if ($locked->active === $active) {
                return $locked;
            }

            if ($active && app(BadgeRules::class)->read($locked->rule_json) === null) {
                throw ValidationException::withMessages(['active' => [(string) __('badges.rule.retired')]]);
            }

            $locked->forceFill(['active' => $active])->save();
            Audit::record(($active ? GiftEvent::BadgeActivated : GiftEvent::BadgeDeactivated)->value, $locked, ['active' => ! $active], ['active' => $active], $reason, $staff);

            return $locked;
        });
    }
}
