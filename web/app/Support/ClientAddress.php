<?php

namespace App\Support;

use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\IpUtils;

/**
 * The client part of a limiter key. An IPv4 address counts as itself; an IPv6 address counts as its /64, because one connection
 * usually gets a whole /64 and could otherwise pose as 2^64 clients (SEC-P1-31 note, carried to M3.1).
 */
final class ClientAddress
{
    public static function key(Request $request): string
    {
        return self::of((string) $request->ip());
    }

    public static function of(string $ip): string
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false) {
            return $ip;
        }

        // An IPv4-mapped address is an IPv4 client.
        if (str_starts_with(strtolower($ip), '::ffff:') && filter_var(substr($ip, 7), FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            return substr($ip, 7);
        }

        return IpUtils::anonymize($ip, 4, 8).'/64';
    }
}
