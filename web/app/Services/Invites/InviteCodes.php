<?php

namespace App\Services\Invites;

use App\Models\InviteCode;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Invite codes (m5.9d contract §5): `invites.per_member` codes of 8 characters Crockford base 32 per member, created on the first read.
 * A code is redeemed once, at the invitee's activation (MemberActivation); both sides then get the "Crew Starter" badge and nothing
 * else (no XP, no money). A code of a deleted, suspended or unverified inviter does not work; a member never redeems their own code.
 */
final class InviteCodes
{
    /** Crockford base 32: no I, L, O, U. */
    public const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    public const PATTERN = '/\A[0-9A-HJKMNP-TV-Z]{8}\z/';

    /**
     * A code as a link or a member typed it: trimmed, uppercase, the look-alikes I/L → 1 and O → 0 (as the app's normalizeInviteCode);
     * null when it cannot be a code.
     */
    public static function normalize(mixed $raw): ?string
    {
        if (! is_string($raw)) {
            return null;
        }

        $code = strtr(strtoupper(trim($raw)), ['I' => '1', 'L' => '1', 'O' => '0']);

        return preg_match(self::PATTERN, $code) === 1 ? $code : null;
    }

    /**
     * The member's codes, oldest first, creating the missing ones up to `invites.per_member` (once: redeemed codes are not replaced).
     *
     * @return Collection<int, InviteCode>
     */
    public function for(User $member): Collection
    {
        $wanted = max(0, config()->integer('speedclub.invites.per_member'));

        DB::transaction(function () use ($member, $wanted): void {
            DB::table('users')->where('id', $member->id)->lockForUpdate()->value('id');
            $have = InviteCode::query()->where('inviter_id', $member->id)->count();

            for ($i = $have; $i < $wanted; $i++) {
                $this->create($member);
            }
        });

        return InviteCode::query()->where('inviter_id', $member->id)->with('invitee.avatar')->orderBy('created_at')->orderBy('code')->get();
    }

    /**
     * An open code whose inviter may invite now; null for an unknown, used or dead code. Used = accepted_at set (CR-P5G-10 /
     * SEC-P5G-06): accepted_by goes null when the invitee's account is hard-deleted, and the code must stay redeemed.
     */
    public function open(?string $code): ?InviteCode
    {
        if ($code === null) {
            return null;
        }

        $invite = InviteCode::query()->whereKey($code)->whereNull('accepted_by')->whereNull('accepted_at')->with('inviter')->first();

        return $invite instanceof InviteCode && $invite->inviter instanceof User && self::mayInvite($invite->inviter) ? $invite : null;
    }

    /**
     * Redeems $code for the newly activated $invitee inside the caller's transaction; the code, or null when it is not open, is the
     * invitee's own or the invitee already redeemed one.
     */
    public function redeem(User $invitee, string $code): ?InviteCode
    {
        $invite = InviteCode::query()->whereKey($code)->lockForUpdate()->first();

        if (! $invite instanceof InviteCode || $invite->accepted_by !== null || $invite->accepted_at !== null || $invite->inviter_id === $invitee->id) {
            return null;
        }

        $inviter = User::query()->find($invite->inviter_id);

        if (! $inviter instanceof User || ! self::mayInvite($inviter) || InviteCode::query()->where('accepted_by', $invitee->id)->exists()) {
            return null;
        }

        $invite->forceFill(['accepted_by' => $invitee->id, 'accepted_at' => now()])->save();

        return $invite;
    }

    /**
     * Whose codes work: a member others may see (verified, active, not deleted), with a username. A sample account's codes work outside
     * production only (lead decision, crawl triage M5.9f: the staging showcase's INV-01 and `/join/{code}` behave like a real member's;
     * the same environment rule as WrappedReleases::opens), never in production, where samples do not exist.
     */
    public static function mayInvite(User $inviter): bool
    {
        return ! $inviter->trashed() && $inviter->isPubliclyVisible() && $inviter->hasUsername()
            && ($inviter->getAttribute('is_sample') !== true || ! app()->isProduction());
    }

    private function create(User $member): void
    {
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $code = '';

            for ($i = 0; $i < config()->integer('speedclub.invites.length'); $i++) {
                $code .= self::ALPHABET[random_int(0, 31)];
            }

            $inserted = DB::table('invite_codes')->insertOrIgnore([
                'code' => $code,
                'inviter_id' => $member->id,
                'created_at' => now(),
            ]);

            if ($inserted === 1) {
                return;
            }
        }
    }
}
