<?php

namespace App\Mail;

/**
 * Someone tried to register with an address that has an account. F1's "Anmelden / Passwort vergessen" reaches the owner here.
 */
class AccountExistsMail extends AuthMail
{
    public function __construct(public readonly string $email) {}

    protected function subjectLine(): string
    {
        return (string) __('mail.exists.subject');
    }

    protected function heading(): string
    {
        return (string) __('mail.exists.heading');
    }

    protected function lines(): array
    {
        return [(string) __('mail.exists.intro')];
    }

    /**
     * The address rides in the fragment (ADR-138, m2.5-contract addendum): browsers never send it, so it reaches no access log.
     */
    protected function actions(): array
    {
        $email = http_build_query(['email' => $this->email], '', '&', PHP_QUERY_RFC3986);

        return [
            ['label' => (string) __('mail.exists.sign_in'), 'url' => $this->url('/app/sign-in#'.$email)],
            ['label' => (string) __('mail.exists.reset'), 'url' => $this->url('/app/forgot-password#'.$email)],
        ];
    }

    protected function note(): string
    {
        return (string) __('mail.exists.note');
    }
}
