<?php

namespace App\Actions\Auth;

use App\Enums\DevicePlatform;
use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Exceptions\ApiException;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Support\Auth\AuthResult;
use App\Support\Auth\DeviceInfo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class RotateMemberToken
{
    public function __construct(private readonly IssueDeviceToken $tokens) {}

    /**
     * Only tokens older than the rotation age; a cookie session has none to rotate (05_ARCHITECTURE §7). A new token is a
     * new way in, so it asks what a sign-in asks: nobody suspended or deactivated, and no password change pending.
     *
     * The answer can get lost after the commit, and then the device holds only the old token. So the old token stays for a short
     * grace period (speedclub.tokens.rotation_grace_seconds), which is never extended. A repeat on it within that time:
     * - the new token was never used: the answer got lost. It is revoked and a fresh one answered, so the device keeps one token and
     *   nothing stays behind that nobody holds. Two parallel calls meet at the row lock and end the same way. This is written down: from
     *   here it cannot be told from a copied old token that takes the device's place, so the record is what a later look can go by.
     * - the new token was used: the device has it, so this repeat is not that device's retry. 409 conflict, and the old token goes at once.
     *
     * $deviceId is the app's per-install id. A token that has one keeps it, whatever is sent. A token from an older app build that has
     * none takes the one sent: holding the token proves it is this install, and the new token then counts as this device alone
     * (IssueDeviceToken, PersonalAccessToken::onSameDevice).
     *
     * @throws ApiException 409 conflict for a cookie session, a token gone or a token already replaced and claimed
     */
    public function handle(User $user, ?string $deviceId = null): AuthResult
    {
        SignInMember::ensureMayEnter($user);

        $current = $user->currentAccessToken();

        if (! $current instanceof PersonalAccessToken) {
            throw new ApiException(ErrorCode::Conflict, (string) __('errors.token_required'));
        }

        $result = DB::transaction(function () use ($user, $current, $deviceId): ?AuthResult {
            $owner = User::query()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();

            SignInMember::ensureMayEnter($owner);

            if ($owner->getAttribute('force_password_change') === true) {
                throw DemandPasswordChange::refusal($owner);
            }

            $token = PersonalAccessToken::query()->whereKey($current->getKey())->lockForUpdate()->first();

            if ($token === null) {
                throw new ApiException(ErrorCode::Conflict);
            }

            /** @var Carbon $created */
            $created = $token->getAttribute('created_at');
            $due = $created->copy()->addDays(config()->integer('speedclub.tokens.rotate_after_days'));

            if ($due->isFuture()) {
                throw new ApiException(ErrorCode::TokenRotationNotDue, data: ['retry_at' => $due->toIso8601String()]);
            }

            // Before the replacements are looked up, so a retry from an install that sent its id finds them by that id.
            if ($token->deviceId() === null && $deviceId !== null) {
                $token->forceFill(['device_id' => $deviceId])->save();
            }

            // What a rotation leaves always has a device_name. A later token with only the same name is an older sign-in, not a replacement.
            // With a device_id a later sign-in on this install would have ended this token (IssueDeviceToken), so a later one is a replacement.
            $replacements = $token->onSameDevice()->where('id', '>', $token->getKey())->whereNotNull('device_name')->lockForUpdate()->get();

            // Not thrown in here: the rollback would bring the old token back.
            if ($replacements->contains(fn (PersonalAccessToken $replacement): bool => $replacement->getAttribute('last_used_at') !== null)) {
                $token->delete();
                Audit::record(MemberSecurityEvent::TokenReplayed->value, $owner, actor: $owner);

                return null;
            }

            if ($replacements->isNotEmpty()) {
                $replacements->each(fn (PersonalAccessToken $replacement): ?bool => $replacement->delete());
                Audit::record(MemberSecurityEvent::TokenRotationRetried->value, $owner, actor: $owner);
            }

            $this->startGrace($token);

            $version = $token->getAttribute('app_version');
            $platform = $token->getAttribute('platform');

            return $this->tokens->create($owner, new DeviceInfo(
                $token->deviceName(),
                $platform instanceof DevicePlatform ? $platform : null,
                is_string($version) ? $version : null,
                $token->deviceId(),
            ));
        });

        return $result ?? throw new ApiException(ErrorCode::Conflict);
    }

    /**
     * A token that expires sooner keeps its own end: this never gives more time, not even on a retry.
     */
    private function startGrace(PersonalAccessToken $token): void
    {
        $end = now()->addSeconds(config()->integer('speedclub.tokens.rotation_grace_seconds'));
        /** @var Carbon|null $expires */
        $expires = $token->getAttribute('expires_at');

        if ($expires === null || $expires->greaterThan($end)) {
            $token->forceFill(['expires_at' => $end])->save();
        }
    }
}
