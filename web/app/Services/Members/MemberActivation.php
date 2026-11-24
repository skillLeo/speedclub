<?php

namespace App\Services\Members;

use App\Enums\GiftEvent;
use App\Models\InviteCode;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Badges\BadgeAwarder;
use App\Services\Invites\InviteCodes;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * The moment an account activates (m5.9d contract §4, §5): its address is verified and the current terms are accepted, for the first
 * time. Callers: VerifyMemberEmail (registration with a password: terms at sign-up, the code proves the address), AcceptOnboardingTerms
 * (passwordless, Apple, Google: the address is proved first, AUTH-09b accepts the terms), ResetMemberPassword (a reset that proves an
 * address nobody had verified) and staff's ChangeMemberEmail. Once only (users.activated_at, under the member's row lock):
 *
 * - the Founding Member number (FoundingNumbers: production only, never staff, sample, editorial or demo accounts);
 * - the invite code the sign-up carried (users.pending_invite_code): redeemed when it is open and not the member's own; the inviter
 *   gets the invite_accepted row and push, both get the "Crew Starter" badge through their badge check, nothing else;
 * - the badge check of the member.
 *
 * noteInvite() keeps a code for that moment; for an account that is active already a code is ignored (an existing member signing in
 * with somebody's link). An invalid code is ignored, never refused.
 */
final class MemberActivation
{
    public function __construct(
        private readonly FoundingNumbers $founding,
        private readonly InviteCodes $invites,
        private readonly BadgeAwarder $badges,
        private readonly Notifier $notifier,
    ) {}

    public static function ready(User $user): bool
    {
        return ! $user->trashed() && $user->hasVerifiedEmail() && ! $user->isPendingTerms();
    }

    /**
     * Keeps the sign-up's invite code until the account activates. A later valid code replaces an earlier one.
     */
    public function noteInvite(User $user, mixed $raw): void
    {
        $code = InviteCodes::normalize($raw);

        if ($code === null || $user->getAttribute('activated_at') !== null) {
            return;
        }

        DB::table('users')->where('id', $user->id)->whereNull('activated_at')->update(['pending_invite_code' => $code]);
        $user->forceFill(['pending_invite_code' => $code])->syncOriginalAttribute('pending_invite_code');
    }

    /**
     * Activates the member when they are ready and were never activated; nothing otherwise.
     */
    public function activate(User $user): void
    {
        if ($user->getAttribute('activated_at') !== null || ! self::ready($user)) {
            return;
        }

        if (FoundingNumbers::eligible($user)) {
            $this->founding->prepare();
        }

        /** @var array{0: User, 1: InviteCode|null}|null $result */
        $result = DB::transaction(function () use ($user): ?array {
            $locked = User::query()->whereKey($user->id)->lockForUpdate()->first();

            if (! $locked instanceof User || $locked->getAttribute('activated_at') !== null || ! self::ready($locked)) {
                return null;
            }

            $locked->forceFill(['activated_at' => now()])->save();
            $number = $this->founding->assign($locked);
            $code = InviteCodes::normalize($locked->getAttribute('pending_invite_code'));
            $invite = $code === null ? null : $this->invites->redeem($locked, $code);
            $locked->forceFill(['pending_invite_code' => null])->save();

            if ($number !== null) {
                Audit::record(GiftEvent::FoundingNumberAssigned->value, $locked, after: ['founding_number' => $number], actor: $locked);
            }

            return [$locked, $invite];
        }, FoundingNumbers::ATTEMPTS);

        if ($result === null) {
            return;
        }

        [$locked, $invite] = $result;
        $user->forceFill([
            'activated_at' => $locked->getAttribute('activated_at'),
            'founding_number' => $locked->getAttribute('founding_number'),
            'pending_invite_code' => null,
        ])->syncOriginalAttributes(['activated_at', 'founding_number', 'pending_invite_code']);

        $this->badges->queue($locked);

        if ($invite instanceof InviteCode) {
            $this->badges->queue($invite->inviter_id);
            $inviterId = $invite->inviter_id;
            $code = $invite->code;

            DB::afterCommit(function () use ($inviterId, $code): void {
                $inviter = User::query()->find($inviterId);

                if ($inviter instanceof User) {
                    $this->notifier->inviteAccepted($inviter, $code);
                }
            });
        }
    }
}
