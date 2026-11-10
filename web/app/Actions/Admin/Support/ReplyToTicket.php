<?php

namespace App\Actions\Admin\Support;

use App\Enums\SupportTicketStatus;
use App\Enums\TicketAuthorType;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Models\User;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Notifications\Notifier;
use App\Services\Support\SendSupportReplyMail;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-26 reply (`support.reply`, m3.4-contract §1): a staff message in the ticket's thread. A member reads it in the app's SET-15 thread
 * (GET support/tickets/{ticket}) and gets an in-app `support_reply` notification (no push, 02 §7); a WEB-10 guest gets it by e-mail
 * (SendSupportReplyMail, queued). The member answers in the thread (POST support/tickets/{ticket}/messages, AddMemberReply). The
 * ticket moves to the status the staff member picks (default: waiting for the member), the ticket is assigned to them if nobody had
 * it. Audited `support.replied` without the text.
 *
 * @throws AuthorizationException
 */
class ReplyToTicket
{
    public function __construct(private readonly Notifier $notifier) {}

    public function handle(Staff $staff, SupportTicket $ticket, string $body, SupportTicketStatus $status = SupportTicketStatus::Pending): TicketMessage
    {
        StaffAtoms::ensure($staff, 'support.reply');

        return DB::transaction(function () use ($staff, $ticket, $body, $status): TicketMessage {
            $locked = SupportTicket::query()->whereKey($ticket->id)->lockForUpdate()->firstOrFail();
            $before = ['status' => $locked->status->value];

            $message = new TicketMessage(['body' => trim($body)]);
            $message->forceFill(['ticket_id' => $locked->id, 'author_type' => TicketAuthorType::Staff, 'staff_id' => $staff->id, 'internal' => false])->save();

            $locked->forceFill([
                'status' => $status,
                'closed_at' => $status === SupportTicketStatus::Closed ? now() : null,
                'assigned_staff_id' => $locked->assigned_staff_id ?? $staff->id,
                'last_activity_at' => now(),
            ])->save();

            Audit::record('support.replied', $locked, $before, ['status' => $status->value, 'message_id' => $message->id, 'channel' => $locked->user_id === null ? 'email' : 'app'], actor: $staff);

            if ($locked->user_id === null) {
                DB::afterCommit(fn () => SendSupportReplyMail::dispatch($message->id));
            } else {
                DB::afterCommit(function () use ($locked): void {
                    $member = User::query()->find($locked->user_id);

                    if ($member instanceof User) {
                        $this->notifier->supportReply($member, $locked);
                    }
                });
            }

            return $message;
        });
    }
}
