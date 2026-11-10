<?php

namespace App\Mail;

class VerificationCodeMail extends AuthMail
{
    public function __construct(string $code, public readonly ?string $email = null)
    {
        $this->code = $code;
    }

    protected function subjectLine(): string
    {
        return (string) __('mail.verification.subject', ['code' => $this->code]);
    }

    protected function heading(): string
    {
        return (string) __('mail.verification.heading');
    }

    protected function lines(): array
    {
        return [(string) __('mail.verification.intro')];
    }

    /**
     * WEB-07 (ADR-207 h): the landing continues in the browser or the app. Code and address ride in the fragment, which no browser
     * sends, so neither reaches an access log (ADR-138). The code alone works without any link.
     */
    protected function actions(): array
    {
        $fragment = http_build_query(array_filter(['code' => $this->code, 'email' => $this->email]), '', '&', PHP_QUERY_RFC3986);

        return [['label' => (string) __('mail.verification.action'), 'url' => $this->url('/email/verify#'.$fragment)]];
    }

    protected function note(): string
    {
        return (string) __('mail.code_note', ['minutes' => config()->integer('speedclub.verification.expires_minutes')]);
    }
}
