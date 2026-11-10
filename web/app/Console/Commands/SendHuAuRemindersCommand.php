<?php

namespace App\Console\Commands;

use App\Services\Garage\HuAuReminders;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('vehicles:hu-au-reminders')]
#[Description('Remind owners 30 days before their HU/AU month, once per due date [SIG sig.hu_au_reminder]')]
class SendHuAuRemindersCommand extends Command
{
    public function handle(HuAuReminders $reminders): int
    {
        $sent = $reminders->run();
        $this->info($sent === null ? 'HU/AU reminders are switched off.' : "Sent $sent HU/AU reminders.");

        return self::SUCCESS;
    }
}
