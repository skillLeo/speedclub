<?php

namespace App\Console\Commands;

use App\Enums\DataExportStatus;
use App\Models\DataExport;
use App\Services\DataExport\BuildDataExport;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * SEC-P3-12, run once after the deploy that fixed it: a member's own export built before the fix may hold the team's internal ticket
 * notes. Every such export still downloadable (ready, the member's copy only; one built after the deploy is clean) of a member with a ticket note is expired
 * and its files deleted; the member can ask for a new one on SET-12. Idempotent: a second run finds nothing.
 */
#[Signature('speedclub:exports:expire-ticket-notes')]
#[Description('Expire member data exports built before SEC-P3-12 that may contain internal support ticket notes (run once)')]
class ExpireExportsWithTicketNotesCommand extends Command
{
    public function handle(): int
    {
        $expired = 0;

        DataExport::query()
            ->whereNull('requested_by_staff_id')
            ->where('status', DataExportStatus::Ready)
            ->whereExists(fn ($query) => $query->selectRaw('1')->from('support_tickets')
                ->whereColumn('support_tickets.user_id', 'data_exports.user_id')
                ->whereExists(fn ($notes) => $notes->selectRaw('1')->from('ticket_messages')->whereColumn('ticket_messages.ticket_id', 'support_tickets.id')->where('ticket_messages.internal', true)))
            ->orderBy('id')
            ->chunkById(200, function ($exports) use (&$expired): void {
                foreach ($exports as $export) {
                    BuildDataExport::deleteFiles($export);
                    $export->forceFill(['status' => DataExportStatus::Expired, 'path' => null, 'progress' => null])->save();
                    $expired++;
                }
            });

        $this->info("{$expired} export(s) expired.");

        return self::SUCCESS;
    }
}
