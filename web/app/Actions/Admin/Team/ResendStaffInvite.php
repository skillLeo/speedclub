<?php

namespace App\Actions\Admin\Team;

use App\Enums\StaffStatus;
use App\Enums\TeamEvent;
use App\Mail\StaffInviteMail;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Team\StaffInvites;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-39 "Einladung erneut senden" (`staff.invite`): a new 72-hour link replaces the open one (m3.6 §1). Only for an account that has
 * not set its password yet. An invited Owner is re-invited by an Owner only.
 *
 * @throws AuthorizationException|TeamRefused
 */
class ResendStaffInvite
{
    public function __construct(private readonly StaffInvites $invites, private readonly AuthMailer $mailer) {}

    public function handle(Staff $by, Staff $invitee, string $locale = 'de'): void
    {
        StaffAtoms::ensure($by, 'staff.invite');

        if (! $invitee->isInvited() || $invitee->status !== StaffStatus::Active) {
            throw new TeamRefused('not_invited');
        }

        if ($invitee->isOwner() && ! $by->isOwner()) {
            throw new TeamRefused('owner_only');
        }

        $link = DB::transaction(function () use ($by, $invitee): string {
            $link = $this->invites->issue($invitee, $by);
            Audit::record(TeamEvent::InviteResent->value, $invitee, actor: $by);

            return $link;
        });

        $this->mailer->sendLater($invitee->email, in_array($locale, config('speedclub.locales'), true) ? $locale : 'de',
            new StaffInviteMail($invitee->name, $link, now()->addHours(config()->integer('speedclub.team.invite_hours'))));
    }
}
