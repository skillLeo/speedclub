<?php

namespace App\Actions\Me;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\Reauthentication;
use App\Services\Auth\TwoFactor;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * SET-05: a new set of ten replaces every old code, used or not.
 */
class RegenerateRecoveryCodes
{
    public function __construct(
        private readonly Reauthentication $reauth,
        private readonly TwoFactor $twoFactor,
        private readonly Notifier $notifier,
    ) {}

    /**
     * @return list<string>
     */
    public function handle(User $user, string $password, string $code): array
    {
        if (! $user->hasTwoFactor()) {
            throw new ApiException(ErrorCode::Conflict, (string) __('settings.two_factor.not_on'));
        }

        $this->reauth->password($user, $password);
        $factor = $this->reauth->secondFactor($user, $code);
        $codes = $this->twoFactor->newRecoveryCodes();

        DB::transaction(function () use ($user, $codes, $factor): void {
            $user->forceFill(['two_factor_recovery_codes' => $codes['hashes']])->save();

            Audit::record(MemberSecurityEvent::RecoveryCodesRegenerated->value, $user, after: ['factor' => $factor], actor: $user);
        });

        $this->notifier->security($user, SecurityNotice::TwoFactorChanged, variant: 'recovery_codes');

        return $codes['plain'];
    }
}
