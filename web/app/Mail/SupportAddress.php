<?php

namespace App\Mail;

use App\Services\Privacy\OrgIdentity;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * The support mailbox the mails name: the support address of the org settings (ADM-52) when the Owner set one, else
 * speedclub.app_config.links.support_email (env SUPPORT_EMAIL).
 */
final class SupportAddress
{
    public static function get(): string
    {
        try {
            $org = app(OrgIdentity::class)->get('support_email');
        } catch (Throwable) {
            // No database yet (install, a broken connection): the configured address still names a mailbox.
            $org = null;
        }

        if (is_string($org) && $org !== '') {
            return $org;
        }

        $address = config('speedclub.app_config.links.support_email');

        return is_string($address) && $address !== '' ? $address : 'support@speedclub.de';
    }

    /** OrgSchema::published(): the org cache holds the address. */
    public static function forget(): void
    {
        Cache::forget(OrgIdentity::CACHE_KEY);
    }
}
