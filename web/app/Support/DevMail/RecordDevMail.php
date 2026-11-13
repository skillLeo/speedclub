<?php

namespace App\Support\DevMail;

use Illuminate\Mail\Events\MessageSent;
use Symfony\Component\Mime\Address;
use Symfony\Component\Mime\Email;

/**
 * Registered by AppServiceProvider in the preview environments only. A failure here must not break the mail itself.
 *
 * SEC-M46-04: outside the developer environments (speedclub.dev_mail.environments) a mail is recorded only while the host sends to the
 * log mailer, i.e. while no mail reaches anybody anyway. A staging host with real SMTP records nothing for ADM-61.
 */
final class RecordDevMail
{
    public function __construct(private readonly DevMailbox $mailbox) {}

    public function handle(MessageSent $event): void
    {
        /** @var list<string> $developer */
        $developer = config()->array('speedclub.dev_mail.environments');

        if (! app()->environment($developer) && config('mail.default') !== 'log') {
            return;
        }

        $message = $event->sent->getOriginalMessage();

        if (! $message instanceof Email) {
            return;
        }

        $code = $event->data['code'] ?? null;

        $this->mailbox->store([
            'at' => now('UTC')->toIso8601String(),
            'to' => array_values(array_map(fn (Address $address): string => $address->getAddress(), $message->getTo())),
            'subject' => (string) $message->getSubject(),
            'html' => $this->body($message->getHtmlBody()),
            'text' => $this->body($message->getTextBody()),
            'code' => is_string($code) ? $code : null,
        ]);
    }

    /**
     * @param  resource|string|null  $body
     */
    private function body(mixed $body): string
    {
        return is_resource($body) ? (string) stream_get_contents($body) : (string) $body;
    }
}
