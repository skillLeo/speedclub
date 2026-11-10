<?php

namespace App\Actions\Admin\Members;

use App\Actions\Auth\RequestPasswordReset;
use App\Enums\AdminMemberEvent;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-10 "Reset-Link senden" (`members.reset_password`): the member's own reset-code mail through the forgot flow, after the response
 * (RequestPasswordReset). Staff never see or set a password (06_ADMIN_SPEC §1). A closed account gets nothing, as in the forgot flow.
 *
 * @throws AuthorizationException
 */
class SendMemberResetLink
{
    public function __construct(private readonly RequestPasswordReset $reset) {}

    public function handle(Staff $staff, User $member, string $reason): void
    {
        StaffAtoms::ensure($staff, 'members.reset_password');

        DB::transaction(function () use ($staff, $member, $reason): void {
            Audit::record(AdminMemberEvent::ResetLinkSent->value, $member, after: ['sent' => ! $member->isDeactivated()], reason: trim($reason), actor: $staff);
        });

        $this->reset->handle($member->email);
    }
}
