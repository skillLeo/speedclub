<?php

namespace App\Actions\Security;

use App\Enums\LoginPurpose;
use App\Mail\EmailCodeMail;
use App\Models\User;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\EmailCodes;
use App\Support\Auth\EmailCodeStarted;

/**
 * POST me/reauth/email (09 §8.1): a code of purpose reauth to the member's own address, with the same limits as every e-mail code.
 */
class StartReauthCode
{
    public function __construct(
        private readonly EmailCodes $codes,
        private readonly AuthMailer $mailer,
    ) {}

    public function handle(User $user, string $attemptId): EmailCodeStarted
    {
        $issued = $this->codes->issue($user->email, $attemptId, LoginPurpose::Reauth, $user->id);

        if ($issued !== null) {
            $locale = $user->getAttribute('locale');
            $this->mailer->sendLater($user->email, is_string($locale) ? $locale : app()->getLocale(), new EmailCodeMail(LoginPurpose::Reauth, $issued->code));
        }

        return new EmailCodeStarted($attemptId, $this->codes->resendAfter($user->email, LoginPurpose::Reauth));
    }
}
