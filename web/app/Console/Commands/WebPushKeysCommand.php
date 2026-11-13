<?php

namespace App\Console\Commands;

use App\Mail\SupportAddress;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Minishlink\WebPush\VAPID;
use Throwable;

/**
 * M4.15 (ADR-452, OA-32): a new VAPID key pair for Web Push, printed for the owner to put into the host's .env. It never writes a
 * file: the private key exists only in this output until the owner stores it. Run it once per host and keep the pair; a new pair cuts
 * off every browser that subscribed with the old public key until its member turns notifications on again.
 */
#[Signature('speedclub:web-push-keys')]
#[Description('Generate a VAPID key pair for Web Push and print it (never writes .env)')]
class WebPushKeysCommand extends Command
{
    public function handle(): int
    {
        try {
            $keys = VAPID::createVapidKeys();
        } catch (Throwable $exception) {
            $this->error('Could not create a P-256 key ('.$exception::class.'). Check the openssl extension.');

            return self::FAILURE;
        }

        $configured = is_string(config('speedclub.web_push.public_key')) && config('speedclub.web_push.public_key') !== '';

        if ($configured) {
            $this->warn('This host already has WEB_PUSH_VAPID_PUBLIC_KEY. Replacing it cuts off every subscribed browser.');
        }

        $this->line('Add these three lines to the .env of the host (not to any file in git), then run php artisan config:cache:');
        $this->newLine();
        $this->line('WEB_PUSH_VAPID_PUBLIC_KEY='.$keys['publicKey']);
        $this->line('WEB_PUSH_VAPID_PRIVATE_KEY='.$keys['privateKey']);
        $this->line('WEB_PUSH_VAPID_SUBJECT=mailto:'.SupportAddress::get());
        $this->newLine();
        $this->line('The subject is the push services\' contact: change it to another mailto: or https:// address if needed.');

        return self::SUCCESS;
    }
}
