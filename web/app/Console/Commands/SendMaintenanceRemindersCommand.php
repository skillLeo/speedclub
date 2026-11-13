<?php

namespace App\Console\Commands;

use App\Services\Maintenance\MaintenanceReminders;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('maintenance:reminders')]
#[Description('Send the due maintenance reminders (HU/AU, service, tyres, insurance, custom) once per stage [maintenance]')]
class SendMaintenanceRemindersCommand extends Command
{
    public function handle(MaintenanceReminders $reminders): int
    {
        $sent = $reminders->run();
        $this->info($sent === null ? 'Maintenance reminders are switched off.' : "Sent $sent maintenance reminders.");

        return self::SUCCESS;
    }
}
