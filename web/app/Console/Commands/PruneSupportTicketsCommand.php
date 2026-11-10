<?php

namespace App\Console\Commands;

use App\Models\SupportTicket;
use App\Services\Privacy\RetentionPolicy;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('support:prune')]
#[Description('Delete support tickets 24 months after their last change (06_ADMIN_SPEC §4)')]
class PruneSupportTicketsCommand extends Command
{
    private const BATCH = 1000;

    /**
     * The messages go with the ticket (foreign key). A batch a day keeps the run short; a backlog clears over the following days.
     */
    public function handle(): int
    {
        $ids = SupportTicket::query()
            ->where('updated_at', '<', now()->subMonths(app(RetentionPolicy::class)->value('support_tickets_months')))
            ->limit(self::BATCH)
            ->pluck('id');

        $deleted = SupportTicket::query()->whereKey($ids->all())->delete();

        $this->info("Deleted {$deleted} support tickets.");

        return self::SUCCESS;
    }
}
