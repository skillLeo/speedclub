<?php

namespace App\Actions\Me;

use App\Enums\ErrorCode;
use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Auth\Reauthentication;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * SET-05: off again with the password and a current code or a recovery code (a lost phone).
 */
class DisableTwoFactor
{
    public function __construct(
        private readonly Reauthentication $reauth,
        private readonly Notifier $notifier,
    ) {}

    public function handle(User $user, string $password, string $code): void
    {
        if (! $user->hasTwoFactor()) {
            throw new ApiException(ErrorCode::Conflict, (string) __('settings.two_factor.not_on'));
        }

        $this->reauth->password($user, $password);
        $factor = $this->reauth->secondFactor($user, $code);

        DB::transaction(function () use ($user, $factor): void {
            $user->forceFill([
                'two_factor_secret' => null,
                'two_factor_confirmed_at' => null,
                'two_factor_recovery_codes' => null,
                'two_factor_last_step' => null,
            ])->save();

            Audit::record(MemberSecurityEvent::TwoFactorDisabled->value, $user, after: ['factor' => $factor], actor: $user);
        });

        $this->notifier->security($user, SecurityNotice::TwoFactorChanged, variant: 'disabled');
    }
}
