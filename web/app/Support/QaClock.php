<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

/**
 * The QA clock of the visual matrix (DQ-P5-201, 07 deterministic matrix, ADR-223): outside production a request may name the moment its
 * read-only date windows count from, as the `X-Qa-Now` header (the app's API client, from its own `?qaNow=` override) or the `qaNow`
 * query (the admin pages, contract §2.6). Production never reads either: the hard guard is the environment, not a setting.
 *
 * Only read paths ask it (what "today", "this week" or "the weekend" is for an answer). It never moves the global clock, a write, a
 * stored date, a rate limit, an expiry or a cache key: those always use the real time.
 */
final class QaClock
{
    public const HEADER = 'X-Qa-Now';

    public const QUERY = 'qaNow';

    /** Longer than any ISO 8601 moment the matrix sends; a longer value is ignored, never parsed. */
    private const MAX_LENGTH = 40;

    /** The frozen moment, or the real now. */
    public static function now(?Request $request = null): CarbonImmutable
    {
        return self::frozen($request) ?? CarbonImmutable::now();
    }

    /**
     * The frozen moment of this request outside production, or null when the real clock applies (production, no override, or a value
     * that is not a date). $request defaults to the current one.
     */
    public static function frozen(?Request $request = null): ?CarbonImmutable
    {
        if (app()->environment('production')) {
            return null;
        }

        $request ??= app()->bound('request') ? app('request') : null;

        if (! $request instanceof Request) {
            return null;
        }

        $raw = $request->headers->get(self::HEADER) ?? $request->query(self::QUERY);

        if (! is_string($raw) || $raw === '' || strlen($raw) > self::MAX_LENGTH || strtotime($raw) === false) {
            return null;
        }

        try {
            // In the app's zone like now(), so a query binding of it means the same instant whatever offset the value was sent with.
            return CarbonImmutable::parse($raw)->setTimezone(config()->string('app.timezone'));
        } catch (\Throwable) {
            return null;
        }
    }
}
