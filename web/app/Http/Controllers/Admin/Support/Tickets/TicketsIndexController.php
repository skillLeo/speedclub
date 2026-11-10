<?php

namespace App\Http\Controllers\Admin\Support\Tickets;

use App\Enums\SupportTicketStatus;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Models\SupportTicket;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** ADM-25 support tickets (m3.4-contract §2): the table, the assignment drawer's colleagues and the bulk result panel. */
class TicketsIndexController extends Controller
{
    public function __invoke(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Support/Tickets', [
            ...TableProps::make(TicketListQuery::build($request, $staff), $request, TicketListQuery::TABLE, $staff, fn (array $tickets): array => TicketListQuery::rows($tickets, $staff), TicketListQuery::DEFAULT_SORT),
            'counts' => fn (): array => [
                'open' => SupportTicket::query()->where('status', SupportTicketStatus::Open->value)->count(),
                'pending' => SupportTicket::query()->where('status', SupportTicketStatus::Pending->value)->count(),
                'mine' => SupportTicket::query()->where('assigned_staff_id', $staff->id)->whereIn('status', [SupportTicketStatus::Open->value, SupportTicketStatus::Pending->value])->count(),
            ],
            'staffOptions' => fn (): array => $staff->can('support.reply') ? TicketShowController::colleagues() : [],
            'bulkResult' => fn (): ?array => self::bulkResult($request),
        ]);
    }

    /**
     * @return array{rows: list<array{id: string, ok: bool, code: string|null}>, labels: array<string, string>}|null
     */
    private static function bulkResult(Request $request): ?array
    {
        $result = $request->hasSession() ? $request->session()->get(TicketsBulkController::FLASH) : null;

        if (! is_array($result) || ! is_array($result['rows'] ?? null)) {
            return null;
        }

        /** @var list<array{id: string, ok: bool, code: string|null}> $rows */
        $rows = array_values($result['rows']);
        $labels = [];
        foreach ($rows as $row) {
            $labels[$row['id']] = 'SC-'.strtoupper(substr($row['id'], -8));
        }

        return ['rows' => $rows, 'labels' => $labels];
    }
}
