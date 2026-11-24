<?php

namespace App\Http\Controllers\Admin\Support;

use App\Support\QaClock as SharedQaClock;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

/**
 * "Today" of the admin's read-only day windows (scans of the last 7/30/90 days on ADM-18/19). Outside production the visual matrix
 * freezes it with the same `?qaNow=` the pages read (contract §2.6), so a capture shows the same window every day. It never moves a
 * write, a limit or an expiry: those use the real clock. The parsing and the production guard live in App\Support\QaClock, which the API
 * read paths share (DQ-P5-201).
 */
final class QaClock
{
    public static function now(Request $request): CarbonImmutable
    {
        return self::frozen($request) ?? CarbonImmutable::now();
    }

    /** The frozen moment of `?qaNow=` outside production, or null when the real clock applies (the shared App\Support\QaClock). */
    public static function frozen(Request $request): ?CarbonImmutable
    {
        return SharedQaClock::frozen($request);
    }

    /** The current day in Berlin, where the scan days are counted. */
    public static function today(Request $request): CarbonImmutable
    {
        return self::now($request)->setTimezone('Europe/Berlin')->startOfDay();
    }
}
