<?php

namespace App\Console\Commands;

use App\Services\Events\EventReminders;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('events:reminders')]
#[Description('Remind going members 24 h and 2 h before an event starts, once per event and reminder (09 §8.7)')]
class SendEventRemindersCommand extends Command
{
    public function handle(EventReminders $reminders): int
    {
        $sent = $reminders->run();
        $this->info($sent === null ? 'Events are switched off.' : "Reminded $sent members.");

        return self::SUCCESS;
    }
}
