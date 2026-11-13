<?php

namespace App\Mail;

use App\Enums\LoginPurpose;
use App\Enums\SocialProvider;

/**
 * M4.6 (09 §8.1): the 6-digit code of a passwordless sign-in, a new account, an AUTH-16 link or a re-authentication. A sign-in carries the
 * "Anmelden" button: the same-device magic link /auth/magic with the token in the fragment only (ADR-138), which works only on the device
 * that holds the attempt id. Sent synchronously after the response (ADR-130).
 */
class EmailCodeMail extends AuthMail
{
    public function __construct(
        public readonly LoginPurpose $purpose,
        #[\SensitiveParameter] string $code,
        #[\SensitiveParameter] public readonly ?string $magicToken = null,
        public readonly bool $newAccount = false,
        public readonly ?SocialProvider $provider = null,
    ) {
        $this->code = $code;
    }

    protected function subjectLine(): string
    {
        return (string) __('mail.email_code.'.$this->variant().'.subject', ['code' => $this->code]);
    }

    protected function heading(): string
    {
        return (string) __('mail.email_code.'.$this->variant().'.heading');
    }

    protected function lines(): array
    {
        return [(string) __('mail.email_code.'.$this->variant().'.intro', ['provider' => $this->provider?->label() ?? ''])];
    }

    protected function actions(): array
    {
        if ($this->magicToken === null) {
            return [];
        }

        return [['label' => (string) __('mail.email_code.action'), 'url' => $this->url('/auth/magic#t='.rawurlencode($this->magicToken))]];
    }

    protected function note(): string
    {
        $note = (string) __('mail.code_note', ['minutes' => config()->integer('speedclub.email_code.expires_minutes')]);

        return $this->magicToken === null ? $note : $note.' '.__('mail.email_code.same_device');
    }

    private function variant(): string
    {
        return match ($this->purpose) {
            LoginPurpose::SignIn => $this->newAccount ? 'sign_up' : 'sign_in',
            LoginPurpose::Link => 'link',
            LoginPurpose::Reauth => 'reauth',
            LoginPurpose::ChangeEmail => 'change_email',
        };
    }
}
