<?php

namespace App\Services\Auth;

use Closure;
use Illuminate\Contracts\Mail\Mailable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Throwable;

use function Illuminate\Support\defer;

/**
 * Auth mails leave synchronously in the same PHP process, never through the cron queue (05_ARCHITECTURE §11), but after
 * the response is on its way. That way the time and the outcome of a request do not tell whether a mail was sent for an
 * address, which would undo the neutral answers. On a host without fastcgi_finish_request the client simply waits.
 */
final class AuthMailer
{
    /**
     * @param  Closure(): void  $work
     */
    public function afterResponse(Closure $work): void
    {
        defer(function () use ($work): void {
            try {
                $work();
            } catch (Throwable $exception) {
                // Class name only: transport messages quote addresses (05_ARCHITECTURE §15).
                Log::error('A deferred auth step failed.', ['type' => $exception::class]);
            }
        })->always();
    }

    public function sendLater(string $to, string $locale, Mailable $mail): void
    {
        $this->afterResponse(fn () => $this->send($to, $locale, $mail));
    }

    /**
     * The log mailer writes the whole message to the log, so in production it must not get a code. Everywhere else it is
     * the documented fallback without SMTP (docs/DEPLOY.md §10).
     */
    public function send(string $to, string $locale, Mailable $mail): void
    {
        if (! $this->mayDeliver()) {
            return;
        }

        Mail::to($to)->locale($locale)->send($mail);
    }

    /**
     * False in production with the log mailer, logged. Every auth mail asks first, also the staff reset notification (SEC-P1-27).
     */
    public function mayDeliver(): bool
    {
        if (app()->isProduction() && config('mail.default') === 'log') {
            Log::error('An auth mail was not sent: the log mailer is configured in production.');

            return false;
        }

        return true;
    }
}
