<?php

namespace App\Console\Commands;

use App\Services\Notifications\ExpoPush;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('push:receipts')]
#[Description('Read Expo push receipts and remove tokens of uninstalled apps')]
class CheckPushReceiptsCommand extends Command
{
    public function handle(ExpoPush $push): int
    {
        $result = $push->checkReceipts();
        $this->info("Checked {$result['checked']} push tickets, removed {$result['removed_tokens']} tokens.");

        return self::SUCCESS;
    }
}
