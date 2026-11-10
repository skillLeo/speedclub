<?php

namespace App\Http\Controllers\Admin\Support\Tickets;

use App\Actions\Support\CreateSupportTicket;
use App\Enums\SupportCategory;
use App\Enums\SupportTicketSource;
use App\Enums\SupportTicketStatus;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Models\User;
use App\Services\Admin\Members\MemberRecord;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Spatie\QueryBuilder\AllowedFilter;
use Spatie\QueryBuilder\AllowedSort;
use Spatie\QueryBuilder\Enums\SortDirection;
use Spatie\QueryBuilder\QueryBuilder;

/**
 * ADM-25 tickets (m3.4-contract §2): subject, from (member or web contact), category, status, assignee, last activity; whitelisted filters
 * and sorts, the id as tie-breaker. A web contact's address is masked (DQ-563); ADM-26 reveals it, audited.
 */
final class TicketListQuery
{
    public const TABLE = 'support-tickets';

    public const DEFAULT_SORT = '-last_activity_at';

    /**
     * @return QueryBuilder<SupportTicket>
     */
    public static function build(Request $request, Staff $staff): QueryBuilder
    {
        // DQ-597: "Letzte Aktivität" shows last_activity_at with updated_at as the fallback (a ticket without activity yet), so it sorts
        // on the same value; a plain column sort put those tickets last whatever the direction.
        $activity = AllowedSort::callback('last_activity_at', fn (Builder $q, bool $descending) => $q->orderByRaw(
            'coalesce(support_tickets.last_activity_at, support_tickets.updated_at) '.($descending ? 'desc' : 'asc'),
        ))->defaultDirection(SortDirection::Descending);

        $base = SupportTicket::query()->with(['user:id,username,deleted_at', 'assignedStaff:id,name'])->withCount(['messages' => fn ($q) => $q->where('internal', false)]);

        $query = QueryBuilder::for($base, $request)
            ->allowedFilters(
                AllowedFilter::callback('status', function (Builder $q, mixed $value): void {
                    $value === 'active'
                        ? $q->whereIn('support_tickets.status', [SupportTicketStatus::Open->value, SupportTicketStatus::Pending->value])
                        : $q->where('support_tickets.status', SupportTicketStatus::tryFrom(is_string($value) ? $value : '')->value ?? '-');
                })->delimiter("\u{1}"),
                AllowedFilter::callback('category', fn (Builder $q, mixed $value) => $q->where('support_tickets.category', SupportCategory::tryFrom(is_string($value) ? $value : '')->value ?? '-'))->delimiter("\u{1}"),
                AllowedFilter::callback('source', fn (Builder $q, mixed $value) => $q->where('support_tickets.source', SupportTicketSource::tryFrom(is_string($value) ? $value : '')->value ?? '-'))->delimiter("\u{1}"),
                AllowedFilter::callback('assigned', fn (Builder $q, mixed $value) => match ($value) {
                    'me' => $q->where('support_tickets.assigned_staff_id', $staff->id),
                    'none' => $q->whereNull('support_tickets.assigned_staff_id'),
                    default => $q,
                })->delimiter("\u{1}"),
                AllowedFilter::callback('q', function (Builder $q, mixed $value): void {
                    $text = trim(mb_substr(is_string($value) ? $value : '', 0, 120));
                    $reference = strtolower((string) preg_replace('/^SC-?/i', '', $text));
                    $like = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $text).'%';
                    $q->where(fn (Builder $w) => $w->whereRaw("support_tickets.subject like ? escape '!'", [$like])
                        ->when(strlen($reference) === 8 && ctype_alnum($reference), fn (Builder $r) => $r->orWhere('support_tickets.id', 'like', '%'.$reference)));
                })->delimiter("\u{1}"),
            )
            ->allowedSorts($activity, 'created_at', 'status')
            ->defaultSort($activity);

        $query->getEloquentBuilder()->orderBy('support_tickets.id');

        return $query;
    }

    /**
     * @param  list<SupportTicket>  $tickets
     * @return list<array<string, mixed>>
     */
    public static function rows(array $tickets, Staff $staff): array
    {
        return array_map(fn (SupportTicket $ticket): array => [
            'id' => $ticket->id,
            'reference' => CreateSupportTicket::reference($ticket),
            'subject' => $ticket->getAttribute('subject'),
            'source' => $ticket->source->value,
            // DQ-563: masked for every role in the list; the full address only on ADM-26, through the audited reveal.
            'from' => self::from($ticket, false),
            'category' => $ticket->category->value,
            'status' => $ticket->status->value,
            'assigned' => $ticket->assignedStaff instanceof Staff ? ['id' => $ticket->assignedStaff->id, 'name' => $ticket->assignedStaff->name, 'me' => $ticket->assignedStaff->id === $staff->id] : null,
            'messages' => (int) $ticket->getAttribute('messages_count'),
            'created_at' => $ticket->created_at?->toIso8601String(),
            'last_activity_at' => ($ticket->last_activity_at ?? $ticket->updated_at)?->toIso8601String(),
        ], $tickets);
    }

    /**
     * @return array{kind: 'member'|'web', id: string|null, username: string|null, name: string|null, email: string|null}
     */
    public static function from(SupportTicket $ticket, bool $pii): array
    {
        $member = $ticket->user;
        $email = $ticket->getAttribute('email');

        return [
            'kind' => $ticket->user_id !== null || $ticket->source === SupportTicketSource::App ? 'member' : 'web',
            'id' => $member instanceof User ? $member->id : null,
            'username' => $member instanceof User ? $member->username : null,
            'name' => is_string($ticket->getAttribute('name')) ? $ticket->getAttribute('name') : null,
            'email' => is_string($email) && $email !== '' ? ($pii ? $email : MemberRecord::maskEmail($email)) : null,
        ];
    }
}
