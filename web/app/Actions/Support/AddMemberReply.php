<?php

namespace App\Actions\Support;

use App\Enums\SupportTicketStatus;
use App\Enums\TicketAuthorType;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * SET-15b "Nachfrage senden": the member writes again in their own support thread (POST support/tickets/{ticket}/messages). The ticket
 * goes back to the team as "offen": a closed one opens again, one that waited for the member (pending) is the team's turn again. The
 * ticket moves up in ADM-25 (last_activity_at). Not audited: the member writing to support changes no account and no platform state;
 * the message is never logged.
 */
class AddMemberReply
{
    public function handle(User $member, SupportTicket $ticket, string $body): SupportTicket
    {
        return DB::transaction(function () use ($member, $ticket, $body): SupportTicket {
            $locked = SupportTicket::query()->whereKey($ticket->id)->where('user_id', $member->id)->lockForUpdate()->firstOrFail();

            $message = new TicketMessage(['body' => trim($body)]);
            $message->forceFill(['ticket_id' => $locked->id, 'author_type' => TicketAuthorType::Member, 'user_id' => $member->id, 'internal' => false])->save();

            $locked->forceFill(['status' => SupportTicketStatus::Open, 'closed_at' => null, 'last_activity_at' => now()])->save();

            return $locked;
        });
    }
}
