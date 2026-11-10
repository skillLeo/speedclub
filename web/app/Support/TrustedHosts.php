<?php

namespace App\Support;

/**
 * Host patterns for the TrustHosts middleware: the host of APP_URL, ADMIN_DOMAIN and speedclub.trusted_hosts, nothing else. A Host
 * header an attacker chose must never end up in a password reset link or any other generated URL.
 */
final class TrustedHosts
{
    /**
     * @return list<string>
     */
    public static function patterns(): array
    {
        /** @var list<string> $extra */
        $extra = config()->array('speedclub.trusted_hosts', []);
        // ADMIN_DOMAIN: the admin's own host (RestrictAdminAccess answers only there) has to pass the host check first.
        $hosts = [parse_url(config()->string('app.url'), PHP_URL_HOST), config('speedclub.staff.domain'), ...$extra];

        return array_values(array_map(
            fn (string $host): string => '^'.preg_quote($host).'$',
            array_unique(array_filter($hosts, is_string(...))),
        ));
    }
}
