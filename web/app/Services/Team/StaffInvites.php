<?php

namespace App\Services\Team;

use App\Models\Staff;
use App\Models\StaffInvitation;
use App\Providers\FortifyServiceProvider;
use Illuminate\Support\Str;

/**
 * Invite links of ADM-39 (m3.6 §1, ADR-218): a random 256-bit token, only its SHA-256 stored, valid speedclub.team.invite_hours and once;
 * a new link replaces every open one of the account. The link is /admin/invite#token=… (on ADMIN_DOMAIN when set): the token stays in
 * the fragment, out of every access log, like the staff reset link (SEC-P1-07); the page posts it.
 */
final class StaffInvites
{
    /**
     * A new link for $invitee; the previous ones stop working. Inside the caller's transaction. Returns the URL for the mail only.
     */
    public function issue(Staff $invitee, ?Staff $by): string
    {
        StaffInvitation::query()->where('staff_id', $invitee->getKey())->whereNull('used_at')->whereNull('replaced_at')
            ->update(['replaced_at' => now()]);

        $token = Str::random(64);

        $invitation = new StaffInvitation;
        $invitation->forceFill([
            'staff_id' => $invitee->getKey(),
            'invited_by' => $by?->getKey(),
            'token_hash' => self::hash($token),
            'expires_at' => now()->addHours(config()->integer('speedclub.team.invite_hours')),
        ])->save();

        return self::url($token);
    }

    /**
     * The usable invitation of $token, locked when $lock (inside a transaction), else null (unknown, used, replaced or expired: the page
     * says the same for all of them).
     */
    public function find(string $token, bool $lock = false): ?StaffInvitation
    {
        if (strlen($token) !== 64) {
            return null;
        }

        $invitation = StaffInvitation::query()->where('token_hash', self::hash($token))->when($lock, fn ($query) => $query->lockForUpdate())->first();

        return $invitation !== null && $invitation->isUsable() && $invitation->staff->isInvited() && $invitation->staff->isActive() ? $invitation : null;
    }

    /** The open invitation of an invited account, for ADM-39 ("Einladung offen bis …"). */
    public function pending(Staff $staff): ?StaffInvitation
    {
        return StaffInvitation::query()->where('staff_id', $staff->getKey())->whereNull('used_at')->whereNull('replaced_at')->latest()->first();
    }

    /** Ends every open link of the account (deactivation, deletion). */
    public function revokeAll(Staff $staff): int
    {
        return StaffInvitation::query()->where('staff_id', $staff->getKey())->whereNull('used_at')->whereNull('replaced_at')
            ->update(['replaced_at' => now()]);
    }

    public static function url(string $token): string
    {
        return FortifyServiceProvider::adminBaseUrl().'/admin/invite#'.http_build_query(['token' => $token], '', '&', PHP_QUERY_RFC3986);
    }

    private static function hash(string $token): string
    {
        return hash('sha256', $token);
    }
}
