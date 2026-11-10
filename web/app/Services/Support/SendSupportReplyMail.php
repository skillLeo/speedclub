<?php

namespace App\Services\Support;

use App\Actions\Support\CreateSupportTicket;
use App\Mail\SupportReplyMail;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Services\Auth\AuthMailer;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * A staff reply to a WEB-10 guest, by e-mail through the cron queue with retries (m3.4-contract §1: "e-mail for web contacts (queued,
 * AuthMailer rules)"): the message id only, the text read at run time, sent once (ticket_messages.mailed_at), never an internal note,
 * never to a member (members read replies in the app).
 */
class SendSupportReplyMail implements ShouldQueue
{
    use Queueable;

    public int $tries = 4;

    public int $timeout = 40;

    public function __construct(public readonly string $messageId) {}

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [60, 300, 1800];
    }

    public function handle(AuthMailer $mailer): void
    {
        $message = TicketMessage::query()->with('ticket')->find($this->messageId);
        $ticket = $message?->ticket;

        if (! $message instanceof TicketMessage || ! $ticket instanceof SupportTicket || $message->internal || $message->mailed_at !== null
            || $ticket->user_id !== null || ! is_string($ticket->getAttribute('email')) || $ticket->getAttribute('email') === '') {
            return;
        }

        $locale = $ticket->getAttribute('locale');
        $mailer->send((string) $ticket->getAttribute('email'), is_string($locale) ? $locale : 'de', new SupportReplyMail(CreateSupportTicket::reference($ticket), $message->body));

        $message->forceFill(['mailed_at' => now()])->save();
    }

    public function failed(?Throwable $exception): void
    {
        Log::error('A support reply mail could not be sent.', ['message' => $this->messageId, 'type' => $exception === null ? null : $exception::class]);
    }
}
