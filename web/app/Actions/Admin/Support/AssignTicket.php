<?php

namespace App\Actions\Admin\Support;

use App\Models\Staff;
use App\Models\SupportTicket;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-25/26 assignment drawer (`support.reply`): the ticket to an active staff member who holds support.reply, or to nobody. Audited
 * `support.ticket_assigned`.
 *
 * @throws AuthorizationException|ValidationException
 */
class AssignTicket
{
    public function handle(Staff $by, SupportTicket $ticket, ?Staff $to): SupportTicket
    {
        StaffAtoms::ensure($by, 'support.reply');

        if ($to !== null && (! $to->isActive() || ! $to->can('support.reply'))) {
            throw ValidationException::withMessages(['staff_id' => [(string) __('validation.exists', ['attribute' => 'staff'])]]);
        }

        return DB::transaction(function () use ($by, $ticket, $to): SupportTicket {
            $locked = SupportTicket::query()->whereKey($ticket->id)->lockForUpdate()->firstOrFail();
            $before = ['assigned_staff_id' => $locked->assigned_staff_id];
            $locked->forceFill(['assigned_staff_id' => $to?->id])->save();

            Audit::record('support.ticket_assigned', $locked, $before, ['assigned_staff_id' => $to?->id], actor: $by);

            return $locked;
        });
    }
}
