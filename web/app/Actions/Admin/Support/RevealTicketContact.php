<?php

namespace App\Actions\Admin\Support;

use App\Models\Staff;
use App\Models\SupportTicket;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Support\PiiReveals;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * ADM-26 "Anzeigen" (`support.view` + `members.view_pii`, DQ-563, code review M3.3-app MF-B): the full address of a web contact (a ticket without an account), which lists and the
 * ticket page show masked. Audited as `support.contact_viewed`, like the member PII reveal (06 §1.1: every view of sensitive data).
 */
class RevealTicketContact
{
    /**
     * @return array{email: string|null}
     *
     * @throws AuthorizationException
     */
    public function handle(Staff $staff, SupportTicket $ticket): array
    {
        StaffAtoms::ensure($staff, 'support.view');
        StaffAtoms::ensure($staff, 'members.view_pii');
        // SEC-P3-21: a daily cap per staff member, shared with the member PII reveal.
        PiiReveals::ensureAllowed($staff);
        $email = $ticket->getAttribute('email');

        DB::transaction(fn () => Audit::record('support.contact_viewed', $ticket, after: ['fields' => ['email']], actor: $staff));

        return ['email' => is_string($email) && $email !== '' ? $email : null];
    }
}
