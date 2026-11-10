<?php

namespace App\Actions\Admin\Support;

use App\Enums\SupportTicketStatus;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-25/26 status (`support.reply`): offen · wartet · gelöst. Audited `support.status_changed` when it changes.
 *
 * @throws AuthorizationException
 */
class SetTicketStatus
{
    public function handle(Staff $staff, SupportTicket $ticket, SupportTicketStatus $status): SupportTicket
    {
        StaffAtoms::ensure($staff, 'support.reply');

        return DB::transaction(function () use ($staff, $ticket, $status): SupportTicket {
            $locked = SupportTicket::query()->whereKey($ticket->id)->lockForUpdate()->firstOrFail();

            if ($locked->status === $status) {
                return $locked;
            }

            $before = ['status' => $locked->status->value];
            $locked->forceFill(['status' => $status, 'closed_at' => $status === SupportTicketStatus::Closed ? now() : null])->save();

            Audit::record('support.status_changed', $locked, $before, ['status' => $status->value], actor: $staff);

            return $locked;
        });
    }
}
