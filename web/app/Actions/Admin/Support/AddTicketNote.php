<?php

namespace App\Actions\Admin\Support;

use App\Enums\TicketAuthorType;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-26 internal note (`support.reply`): visible to the team only, never sent, never in the member's thread. Audited
 * `support.note_added` without the text.
 *
 * @throws AuthorizationException
 */
class AddTicketNote
{
    public function handle(Staff $staff, SupportTicket $ticket, string $body): TicketMessage
    {
        StaffAtoms::ensure($staff, 'support.reply');

        return DB::transaction(function () use ($staff, $ticket, $body): TicketMessage {
            $note = new TicketMessage(['body' => trim($body)]);
            $note->forceFill(['ticket_id' => $ticket->id, 'author_type' => TicketAuthorType::Staff, 'staff_id' => $staff->id, 'internal' => true])->save();
            $ticket->forceFill(['last_activity_at' => now()])->save();

            Audit::record('support.note_added', $ticket, null, ['message_id' => $note->id], actor: $staff);

            return $note;
        });
    }
}
