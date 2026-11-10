<?php

namespace App\Actions\Auth;

use App\Enums\AuthNextStep;
use App\Enums\ErrorCode;
use App\Enums\VerificationPurpose;
use App\Exceptions\ApiException;
use App\Mail\PasswordResetCodeMail;
use App\Models\User;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\VerificationCodes;
use Illuminate\Support\Facades\RateLimiter;

/**
 * force_password_change: no auth and no authenticated route until the password is replaced (ADR-137). The reset path clears
 * the flag. A correct password or code gets a reset code on the way, within the limits of VerificationCodes.
 */
class DemandPasswordChange
{
    public function __construct(
        private readonly VerificationCodes $codes,
        private readonly AuthMailer $mailer,
    ) {}

    public static function refusal(User $user): ApiException
    {
        return new ApiException(ErrorCode::PasswordChangeRequired, data: ['next' => AuthNextStep::ResetPassword->value, 'email' => $user->email]);
    }

    /**
     * Login and verify: asked once, by someone who just proved something.
     */
    public function atSignIn(User $user): never
    {
        $this->sendCode($user, proved: true);

        throw self::refusal($user);
    }

    /**
     * A token or session from before the flag was set. Every request of that client ends here, background ones too, so
     * at most one code an hour, never one that would replace the code the member is about to type, and only a few a day: a
     * phone left running must not use up what login and forgot have to give the member later (ADR-140).
     */
    public function onLiveSignIn(User $user): never
    {
        $key = 'forced-reset-code:'.$user->getKey();

        if (! RateLimiter::tooManyAttempts($key, 1)
            && ! $this->codes->hasOpen($user, VerificationPurpose::PasswordReset)
            && $this->codes->issuedToday($user, VerificationPurpose::PasswordReset) < config()->integer('speedclub.verification.max_background_codes_per_day')) {
            RateLimiter::hit($key, 3600);
            $this->sendCode($user, proved: false);
        }

        throw self::refusal($user);
    }

    private function sendCode(User $user, bool $proved): void
    {
        $code = $this->codes->issue($user, VerificationPurpose::PasswordReset, $proved);

        if ($code !== null) {
            $locale = $user->getAttribute('locale');
            $this->mailer->sendLater($user->email, is_string($locale) ? $locale : app()->getLocale(), new PasswordResetCodeMail($code, $user->email));
        }
    }
}
