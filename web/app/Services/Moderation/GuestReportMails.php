<?php

namespace App\Services\Moderation;

use Illuminate\Support\Facades\RateLimiter;

/**
 * WEB-09 takes any address, unverified, so mails to one address are capped per day (M2.6 review #4, like the support confirmations):
 * the confirmation of receipt and the outcome together, speedclub.moderation.guest_mails_per_day. The key is a hash of the address, never
 * the address.
 */
class GuestReportMails
{
    public function allow(string $email): bool
    {
        $key = 'moderation-guest-mail:'.hash('sha256', mb_strtolower(trim($email)));

        if (RateLimiter::tooManyAttempts($key, config()->integer('speedclub.moderation.guest_mails_per_day'))) {
            return false;
        }

        RateLimiter::hit($key, 86400);

        return true;
    }
}
