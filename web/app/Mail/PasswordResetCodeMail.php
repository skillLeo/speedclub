<?php

namespace App\Mail;

class PasswordResetCodeMail extends AuthMail
{
    public function __construct(string $code, public readonly string $email)
    {
        $this->code = $code;
    }

    protected function subjectLine(): string
    {
        return (string) __('mail.reset.subject');
    }

    protected function heading(): string
    {
        return (string) __('mail.reset.heading');
    }

    protected function lines(): array
    {
        return [(string) __('mail.reset.intro')];
    }

    /**
     * ADR-036: the code works without any link. The link lands on WEB-07 (ADR-207 h), which continues in the browser (AUTH-07 pre-filled)
     * or the app. In the fragment, which no browser sends, so code and address stay out of access logs (ADR-138).
     */
    protected function actions(): array
    {
        return [[
            'label' => (string) __('mail.reset.action'),
            'url' => $this->url('/email/reset#'.http_build_query(['code' => $this->code, 'email' => $this->email], '', '&', PHP_QUERY_RFC3986)),
        ]];
    }

    protected function note(): string
    {
        return (string) __('mail.code_note', ['minutes' => config()->integer('speedclub.verification.expires_minutes')]);
    }
}
