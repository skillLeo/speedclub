<?php

namespace App\Console\Commands;

use App\Services\Messaging\MessageDigest;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('messages:digest')]
#[Description('Queue the daily e-mail of unread messages for members who turned it on (a count, never a message)')]
class SendMessageDigestCommand extends Command
{
    public function handle(MessageDigest $digest): int
    {
        $sent = $digest->run();
        $this->info("Queued {$sent} message digests.");

        return self::SUCCESS;
    }
}
