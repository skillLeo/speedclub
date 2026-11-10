<?php

namespace App\Actions\Me;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\TwoFactor;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * SET-05 step 2: the first code from the app proves the setup worked. Returns the ten recovery codes, the only time they are shown.
 */
class ConfirmTwoFactor
{
    public function __construct(
        private readonly TwoFactor $twoFactor,
        private readonly Notifier $notifier,
    ) {}

    /**
     * @return list<string>
     */
    public function handle(User $user, string $code): array
    {
        $started = $user->getAttribute('two_factor_secret');
        $codes = $this->twoFactor->newRecoveryCodes();

        // The secret is read, checked and confirmed under the member's row lock, and must still be the one this device started
        // (SEC-P2-09): a StartTwoFactor of another device in between replaced it, and confirming then would leave two-factor on with a
        // secret nobody's authenticator holds. verifyCode() takes the same lock again inside this transaction.
        DB::transaction(function () use ($user, $code, $codes, $started): void {
            $fresh = User::query()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();

            if ($fresh->hasTwoFactor()) {
                throw new ApiException(ErrorCode::Conflict, (string) __('settings.two_factor.already_on'));
            }

            $secret = $fresh->getAttribute('two_factor_secret');

            if (! is_string($secret) || $secret === '') {
                throw new ApiException(ErrorCode::Conflict, (string) __('settings.two_factor.nothing_pending'));
            }

            if (! is_string($started) || ! hash_equals($secret, $started) || ! $this->twoFactor->verifyCode($fresh, $code, $secret)) {
                throw ValidationException::withMessages(['code' => [(string) __('settings.code_wrong')]]);
            }

            $fresh->forceFill(['two_factor_confirmed_at' => now(), 'two_factor_recovery_codes' => $codes['hashes']])->save();
            $user->forceFill([
                'two_factor_secret' => $secret,
                'two_factor_confirmed_at' => $fresh->getAttribute('two_factor_confirmed_at'),
                'two_factor_recovery_codes' => $codes['hashes'],
                'two_factor_last_step' => $fresh->getAttribute('two_factor_last_step'),
            ])->syncOriginal();

            Audit::record(MemberSecurityEvent::TwoFactorEnabled->value, $user, actor: $user);
        });

        $this->notifier->security($user, SecurityNotice::TwoFactorChanged, variant: 'enabled');

        return $codes['plain'];
    }
}
