<?php

namespace App\Actions\Auth;

use App\Enums\AuthNextStep;
use App\Enums\VerificationPurpose;
use App\Mail\VerificationCodeMail;
use App\Models\User;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\VerificationCodes;
use App\Support\Auth\NextStep;

/**
 * Always the same answer. All the work happens after the response, so its duration reveals nothing either.
 */
class ResendVerificationCode
{
    public function __construct(
        private readonly VerificationCodes $codes,
        private readonly AuthMailer $mailer,
    ) {}

    public function handle(string $email): NextStep
    {
        $this->mailer->afterResponse(function () use ($email): void {
            $user = User::query()->where('email', $email)->whereNull('email_verified_at')->first();
            $code = $user === null ? null : $this->codes->issue($user, VerificationPurpose::EmailVerification);

            if ($user !== null && $code !== null) {
                $locale = $user->getAttribute('locale');
                $this->mailer->send($user->email, is_string($locale) ? $locale : app()->getLocale(), new VerificationCodeMail($code, $user->email));
            }
        });

        return NextStep::afterCodeRequest(AuthNextStep::VerifyEmail, $email);
    }
}
