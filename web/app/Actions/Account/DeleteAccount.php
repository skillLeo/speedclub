<?php

namespace App\Actions\Account;

use App\Enums\MemberSecurityEvent;
use App\Enums\QrRevocationReason;
use App\Enums\SecurityNotice;
use App\Enums\SocialProvider;
use App\Enums\UserStatus;
use App\Models\DeviceInstall;
use App\Models\Follow;
use App\Models\LoginAttempt;
use App\Models\MemberPasskey;
use App\Models\PasskeyChallenge;
use App\Models\SocialAccount;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VerificationCode;
use App\Services\Account\WithdrawMemberMedia;
use App\Services\Audit\Audit;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\IdTokens\AppleTokens;
use App\Services\Auth\MemberSessions;
use App\Services\Events\EventHousekeeping;
use App\Services\Notifications\Notifier;
use App\Services\PublicPages\OgImages;
use App\Services\PublicPages\SitemapWriter;
use App\Services\Qr\QrCodes;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * SET-13 and WEB-05 (02_PRODUCT_SPEC §3.1, 08_LEGAL_COMPLIANCE §1 and §6): the account closes at once, in one transaction. Status
 * deactivated with deletion_requested_at, so every list, page and search already leaves the member out (isPubliclyVisible); every
 * vehicle leaves search and its QR codes are revoked (account_deleted, WEB-06 "nicht mehr verfügbar"); every token, session and push
 * token ends; follows both ways go; open codes go. An export the member asked for stays buildable and downloadable until its expires_at
 * (lead ruling, amends ADR-203 c): the right of access must not end with the request to delete; HardDeleteAccount removes it. Conversations stay for the other side, which sees "Gelöschtes
 * Mitglied". After the commit: the public photo files (ADR-123, queued in slices), share images, the sitemap, the confirmation mail.
 * accounts:prune hard-deletes within 30 days (HardDeleteAccount).
 *
 * The caller has proved password and, with two-factor on, the second factor. Asking twice changes nothing.
 */
class DeleteAccount
{
    public function __construct(
        private readonly QrCodes $qr,
        private readonly VehicleSearchProjector $search,
        private readonly MemberSessions $sessions,
        private readonly Notifier $notifier,
        private readonly OgImages $og,
        private readonly SitemapWriter $sitemap,
        private readonly AppleTokens $apple,
        private readonly AuthMailer $mailer,
    ) {}

    public function handle(User $user): void
    {
        $closed = DB::transaction(function () use ($user): ?array {
            $fresh = User::withTrashed()->whereKey($user->id)->lockForUpdate()->firstOrFail();

            if ($fresh->isPendingDeletion()) {
                return null;
            }

            $user->forceFill([
                'status' => UserStatus::Deactivated,
                'deletion_requested_at' => now(),
                'remember_token' => Str::random(60),
            ])->save();

            $vehicles = Vehicle::withTrashed()->where('owner_id', $user->id)->get();

            foreach ($vehicles as $vehicle) {
                $this->qr->revoke($vehicle, QrRevocationReason::AccountDeleted);
                $this->search->remove($vehicle->id);
            }

            $follows = Follow::query()->where('follower_id', $user->id)->orWhere('followee_id', $user->id)->delete();
            // The export asked for before keeps its link (ADR-203 c): the member proved password and second factor for this.
            $revoked = $this->sessions->revokeAll($user, keepExportLinks: true);
            VerificationCode::query()->where('user_id', $user->id)->delete();
            // M4.6 (09 §8.1): every way in goes with the request, not only at the hard delete. Apple's refresh tokens are revoked after
            // the commit (they are read here, before their rows go).
            $apple = SocialAccount::query()->where('user_id', $user->id)->where('provider', SocialProvider::Apple)->get();
            $passkeys = MemberPasskey::query()->where('user_id', $user->id)->delete();
            $providers = SocialAccount::query()->where('user_id', $user->id)->delete();
            LoginAttempt::query()->where('user_id', $user->id)->delete();
            PasskeyChallenge::query()->where('user_id', $user->id)->delete();
            // M4.7: the app installs go with the sign-ins; SET-21 rows stay with the account until the hard delete (cascade).
            DeviceInstall::query()->where('user_id', $user->id)->delete();

            Audit::record(MemberSecurityEvent::DeletionRequested->value, $user, after: [
                'vehicles' => $vehicles->count(),
                'follows' => $follows,
                'passkeys' => $passkeys,
                'providers' => $providers,
                ...$revoked,
            ], actor: $user);

            return ['vehicles' => $vehicles, 'apple' => $apple];
        });

        if ($closed === null) {
            return;
        }

        // After the commit: a rollback can bring rows back, but not files.
        // At once after the response, and from the cron queue as well in case this process dies first; a second run finds nothing.
        WithdrawMemberMedia::dispatchAfterResponse($user->id);
        WithdrawMemberMedia::dispatch($user->id);

        foreach ($closed['vehicles'] as $vehicle) {
            $this->safely(fn () => $this->og->purge($vehicle));
        }

        $this->safely(fn () => $this->og->purge($user));
        $this->sitemap->forget();
        // M4.12 (09 §8.7): answers to events go (spots to the waitlist); the member's upcoming events are cancelled and attendees told.
        $this->safely(fn () => app(EventHousekeeping::class)->accountClosed($user));

        $this->notifier->security($user, SecurityNotice::DeletionRequested);

        // 09 §8.1: revoke Sign in with Apple after the response (a 200 is no proof; the outcome is audited and logged).
        foreach ($closed['apple'] as $account) {
            $this->mailer->afterResponse(function () use ($user, $account): void {
                Audit::record(MemberSecurityEvent::AppleRevoked->value, $user, after: ['outcome' => $this->apple->revoke($account)], actor: $user);
            });
        }
    }

    /**
     * The account is closed whatever a file system says; media:prune and og:prune sweep what is left.
     *
     * @param  callable(): mixed  $step
     */
    private function safely(callable $step): void
    {
        try {
            $step();
        } catch (Throwable $exception) {
            report($exception);
        }
    }
}
