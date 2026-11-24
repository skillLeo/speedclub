<?php

namespace App\Actions\Admin\Badges;

use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Badges\BadgeAwarder;

/**
 * Admin badge manager preview: "würde heute N Mitglieder erhalten" for a rule as typed (validated first; 422 on rule_json otherwise).
 * Real members only (verified, terms accepted, active, never samples), whether or not they have the badge. Read-only, not audited.
 */
final class PreviewBadgeRule
{
    public function __construct(private readonly BadgeAwarder $awarder) {}

    /**
     * @param  array<string, mixed>  $rule
     */
    public function handle(Staff $staff, array $rule): int
    {
        StaffAtoms::ensure($staff, 'content.view');

        return $this->awarder->preview($rule);
    }
}
