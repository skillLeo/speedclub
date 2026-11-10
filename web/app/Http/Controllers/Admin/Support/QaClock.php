<?php

namespace App\Http\Controllers\Admin\Support;

use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

/**
 * "Today" of the admin's read-only day windows (scans of the last 7/30/90 days on ADM-18/19). Outside production the visual matrix
 * freezes it with the same `?qaNow=` the pages read (contract §2.6), so a capture shows the same window every day. It never moves a
 * write, a limit or an expiry: those use the real clock.
 */
final class QaClock
{
    public static function now(Request $request): CarbonImmutable
    {
        $frozen = $request->query('qaNow');

        if (! app()->environment('production') && is_string($frozen) && strlen($frozen) <= 40 && strtotime($frozen) !== false) {
            return CarbonImmutable::parse($frozen);
        }

        return CarbonImmutable::now();
    }

    /** The current day in Berlin, where the scan days are counted. */
    public static function today(Request $request): CarbonImmutable
    {
        return self::now($request)->setTimezone('Europe/Berlin')->startOfDay();
    }
}
