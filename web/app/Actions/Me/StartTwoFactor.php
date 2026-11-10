<?php

namespace App\Actions\Me;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Auth\Reauthentication;
use App\Services\Auth\TwoFactor;
use App\Services\Qr\QrRenderer;
use App\Support\Auth\TwoFactorSetup;
use Illuminate\Support\Facades\DB;

/**
 * SET-05 step 1. A new secret replaces a pending one; nothing changes for sign-in until it is confirmed. Needs a proved address: the
 * recovery path of a lost phone is support, and support must be able to reach the member.
 */
class StartTwoFactor
{
    public function __construct(
        private readonly Reauthentication $reauth,
        private readonly TwoFactor $twoFactor,
        private readonly QrRenderer $qr,
    ) {}

    public function handle(User $user, string $password): TwoFactorSetup
    {
        $this->reauth->password($user, $password);

        if (! $user->hasVerifiedEmail()) {
            throw new ApiException(ErrorCode::EmailNotVerified, (string) __('settings.two_factor.needs_verified_email'));
        }

        $secret = $this->twoFactor->newSecret();

        DB::transaction(function () use ($user, $secret): void {
            $fresh = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();

            if ($fresh->hasTwoFactor()) {
                throw new ApiException(ErrorCode::Conflict, (string) __('settings.two_factor.already_on'));
            }

            $user->forceFill([
                'two_factor_secret' => $secret,
                'two_factor_confirmed_at' => null,
                'two_factor_recovery_codes' => null,
                'two_factor_last_step' => null,
            ])->save();
        });

        $url = $this->twoFactor->otpauthUrl($user, $secret);

        return new TwoFactorSetup($secret, $url, $this->qr->svg($url));
    }
}
