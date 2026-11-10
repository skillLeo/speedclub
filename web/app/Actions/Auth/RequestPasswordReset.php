<?php

namespace App\Actions\Auth;

use App\Enums\AuthNextStep;
use App\Enums\VerificationPurpose;
use App\Mail\PasswordResetCodeMail;
use App\Models\User;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\VerificationCodes;
use App\Support\Auth\NextStep;

/**
 * Always the same answer. All the work happens after the response, so its duration reveals nothing either.
 */
class RequestPasswordReset
{
    public function __construct(
        private readonly VerificationCodes $codes,
        private readonly AuthMailer $mailer,
    ) {}

    public function handle(string $email): NextStep
    {
        $this->mailer->afterResponse(function () use ($email): void {
            $user = User::query()->where('email', $email)->first();

            if ($user === null || $user->isDeactivated()) {
                return;
            }

            $code = $this->codes->issue($user, VerificationPurpose::PasswordReset);

            if ($code !== null) {
                $locale = $user->getAttribute('locale');
                $this->mailer->send($user->email, is_string($locale) ? $locale : app()->getLocale(), new PasswordResetCodeMail($code, $user->email));
            }
        });

        return NextStep::afterCodeRequest(AuthNextStep::ResetPassword, $email);
    }
}
