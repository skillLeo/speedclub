<?php

namespace App\Actions\Admin\Support;

use App\Enums\SupportTicketStatus;
use App\Models\Staff;
use App\Models\SupportTicket;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-25/26 "Zuständigkeit" and status in one write (`support.reply`): either or both, in one transaction, each audited by its own
 * Action. $assign false leaves the assignee alone; true with null removes it.
 *
 * @throws AuthorizationException|ValidationException
 */
class UpdateTicket
{
    public function __construct(
        private readonly AssignTicket $assign,
        private readonly SetTicketStatus $status,
    ) {}

    public function handle(Staff $staff, SupportTicket $ticket, bool $assign, ?Staff $to, ?SupportTicketStatus $status): SupportTicket
    {
        return DB::transaction(function () use ($staff, $ticket, $assign, $to, $status): SupportTicket {
            if ($assign) {
                $this->assign->handle($staff, $ticket, $to);
            }

            if ($status !== null) {
                $this->status->handle($staff, $ticket, $status);
            }

            return $ticket->refresh();
        });
    }
}
