<?php

namespace App\Actions\Admin\Members;

use App\Enums\AdminMemberEvent;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-10 "Passwortänderung erzwingen" (`members.reset_password`, recent password): force_password_change (ADR-137). Every way in and
 * every token or session issued before stop with 403 password_change_required until the member sets a new password through the reset
 * code, which the next request of a running app sends them (DemandPasswordChange). Asking twice changes nothing. Audited as must_reset
 * (Audit redacts keys that say password).
 *
 * @throws AuthorizationException
 */
class ForcePasswordChange
{
    public function handle(Staff $staff, User $member, string $reason): void
    {
        StaffAtoms::ensure($staff, 'members.reset_password');

        DB::transaction(function () use ($staff, $member, $reason): void {
            $locked = User::withTrashed()->whereKey($member->id)->lockForUpdate()->firstOrFail();
            $before = $locked->getAttribute('force_password_change') === true;

            $locked->forceFill(['force_password_change' => true])->save();
            $member->setRawAttributes($locked->getAttributes(), true);

            Audit::record(AdminMemberEvent::PasswordChangeForced->value, $locked, ['must_reset' => $before], ['must_reset' => true], trim($reason), $staff);
        });
    }
}
