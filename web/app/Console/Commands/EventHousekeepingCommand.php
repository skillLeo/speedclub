<?php

namespace App\Console\Commands;

use App\Services\Events\EventHousekeeping;
use App\Services\Showcase\ShowcaseEvents;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('events:housekeeping')]
#[Description('Delete cancelled/rejected events after 12 months and past ones after 24, fill waitlists, move sample events forward (M4.12)')]
class EventHousekeepingCommand extends Command
{
    public function handle(EventHousekeeping $housekeeping, ShowcaseEvents $samples): int
    {
        $result = $housekeeping->run();
        $moved = app()->environment(['local', 'staging']) ? $samples->roll() : 0;
        $this->info("Deleted {$result['deleted']} events, promoted {$result['promoted']} from waitlists, cleared {$result['places_cleared']} private places, moved $moved sample events.");

        return self::SUCCESS;
    }
}
