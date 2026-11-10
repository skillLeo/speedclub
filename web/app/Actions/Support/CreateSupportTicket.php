<?php

namespace App\Actions\Support;

use App\Enums\SupportCategory;
use App\Enums\SupportTicketSource;
use App\Enums\SupportTicketStatus;
use App\Enums\TicketAuthorType;
use App\Mail\SupportTicketReceivedMail;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

/**
 * SET-15 (a member, the address comes from the account) and WEB-10 (a guest with name and address). The receipt mail goes through the
 * queue; it names the category and the reference, never the message, which a stranger could have sent under somebody else's address.
 * Guest receipts are bounded per address and day. ADM-25 works the queue in Phase 3.
 */
class CreateSupportTicket
{
    public function forMember(User $member, SupportCategory $category, string $subject, string $message): SupportTicket
    {
        $ticket = $this->create($member, SupportTicketSource::App, $category, $subject, $message, null, null, $this->locale($member));

        $this->receipt($member->email, $ticket);

        return $ticket;
    }

    public function forGuest(string $name, string $email, SupportCategory $category, string $message, string $locale): SupportTicket
    {
        $subject = Str::limit(trim((string) preg_replace('/\s+/u', ' ', $message)), config()->integer('speedclub.support.subject_max_length') - 1, '…');
        $ticket = $this->create(null, SupportTicketSource::Web, $category, $subject, $message, $name, $email, $locale);

        $key = 'support-receipt:'.hash('sha256', $email);

        if (! RateLimiter::tooManyAttempts($key, config()->integer('speedclub.support.guest_confirmations_per_day'))) {
            RateLimiter::hit($key, 86400);
            $this->receipt($email, $ticket);
        }

        return $ticket;
    }

    /**
     * "SC-7H2KQXMB": the end of the ULID, which is its random part.
     */
    public static function reference(SupportTicket $ticket): string
    {
        return 'SC-'.strtoupper(substr($ticket->id, -8));
    }

    private function create(?User $member, SupportTicketSource $source, SupportCategory $category, string $subject, string $message, ?string $name, ?string $email, string $locale): SupportTicket
    {
        return DB::transaction(function () use ($member, $source, $category, $subject, $message, $name, $email, $locale): SupportTicket {
            $ticket = new SupportTicket(['category' => $category, 'subject' => $subject, 'name' => $name, 'email' => $email, 'locale' => $locale]);
            $ticket->forceFill(['user_id' => $member?->id, 'source' => $source, 'status' => SupportTicketStatus::Open])->save();

            $first = new TicketMessage(['body' => $message]);
            $first->forceFill([
                'ticket_id' => $ticket->id,
                'author_type' => $member === null ? TicketAuthorType::Guest : TicketAuthorType::Member,
                'user_id' => $member?->id,
            ])->save();

            return $ticket;
        });
    }

    private function receipt(string $email, SupportTicket $ticket): void
    {
        Mail::to($email)->locale($ticket->getAttribute('locale') ?? 'de')->queue(new SupportTicketReceivedMail($ticket->category, self::reference($ticket)));
    }

    private function locale(User $member): string
    {
        $locale = $member->getAttribute('locale');

        return is_string($locale) && in_array($locale, config()->array('speedclub.locales'), true) ? $locale : 'de';
    }
}
