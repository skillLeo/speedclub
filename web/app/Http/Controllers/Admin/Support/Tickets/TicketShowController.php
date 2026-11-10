<?php

namespace App\Http\Controllers\Admin\Support\Tickets;

use App\Actions\Support\CreateSupportTicket;
use App\Enums\TicketAuthorType;
use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Models\TicketMessage;
use App\Models\User;
use App\Services\Support\SupportMacros;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-26 ticket (m3.4-contract §2): the thread with replies and internal notes told apart, the member link (`members.view`),
 * metadata, the macro picker with the ticket's variables, the assignment drawer's colleagues and the history from the audit log.
 */
class TicketShowController extends Controller
{
    public function __invoke(Request $request, string $ticket): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $row = self::find($ticket);
        $row->loadMissing(['user:id,username,display_name,deleted_at', 'assignedStaff:id,name']);

        return Inertia::render('Support/Ticket', [
            'ticket' => fn (): array => [
                'id' => $row->id,
                'reference' => CreateSupportTicket::reference($row),
                'subject' => $row->getAttribute('subject'),
                'category' => $row->category->value,
                'status' => $row->status->value,
                'source' => $row->source->value,
                'locale' => $row->getAttribute('locale'),
                // Masked here too: "Anzeigen" fetches the full address through the audited reveal (DQ-563).
                'from' => TicketListQuery::from($row, false),
                'member_link' => $row->user instanceof User && ! $row->user->trashed() && $staff->can('members.view'),
                'assigned' => $row->assignedStaff instanceof Staff ? ['id' => $row->assignedStaff->id, 'name' => $row->assignedStaff->name, 'me' => $row->assignedStaff->id === $staff->id] : null,
                'created_at' => $row->created_at?->toIso8601String(),
                'last_activity_at' => ($row->last_activity_at ?? $row->updated_at)?->toIso8601String(),
                'closed_at' => $row->closed_at?->toIso8601String(),
            ],
            'thread' => fn (): array => self::thread($row),
            'macros' => fn (): array => $staff->can('support.reply') ? SupportMacros::all() : [],
            'variables' => fn (): array => SupportMacros::variables($row, $staff),
            'staffOptions' => fn (): array => $staff->can('support.reply') ? self::colleagues() : [],
            'activity' => fn (): array => ActivityFeed::for(['support_ticket' => [$row->id]], $staff),
        ]);
    }

    public static function find(string $id): SupportTicket
    {
        $row = SupportTicket::query()->find(strtolower($id));
        abort_if($row === null, 404);

        return $row;
    }

    /**
     * Active staff who may answer tickets.
     *
     * @return list<array{id: int, name: string}>
     */
    public static function colleagues(): array
    {
        return array_values(Staff::permission('support.reply')->where('status', 'active')->orderBy('name')->orderBy('id')->get(['id', 'name'])
            ->map(fn (Staff $staff): array => ['id' => $staff->id, 'name' => $staff->name])->all());
    }

    /**
     * @return list<array{id: string, author_type: string, author: string|null, body: string, internal: bool, created_at: string, mailed_at: string|null}>
     */
    private static function thread(SupportTicket $ticket): array
    {
        $messages = TicketMessage::query()->where('ticket_id', $ticket->id)->orderBy('created_at')->orderBy('id')->get();
        $staff = Staff::query()->whereIn('id', $messages->pluck('staff_id')->filter()->all())->pluck('name', 'id');
        $member = $ticket->user;

        return array_values($messages->map(fn (TicketMessage $message): array => [
            'id' => $message->id,
            'author_type' => $message->author_type->value,
            'author' => match ($message->author_type) {
                TicketAuthorType::Staff => $staff[$message->staff_id] ?? null,
                TicketAuthorType::Member => $member instanceof User && $member->username !== null ? '@'.$member->username : null,
                TicketAuthorType::Guest => is_string($ticket->getAttribute('name')) ? $ticket->getAttribute('name') : null,
            },
            'body' => $message->body,
            'internal' => $message->internal,
            'created_at' => $message->created_at->toIso8601String(),
            'mailed_at' => $message->mailed_at?->toIso8601String(),
        ])->all());
    }
}
