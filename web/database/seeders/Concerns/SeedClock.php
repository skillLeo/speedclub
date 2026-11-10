<?php

namespace Database\Seeders\Concerns;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Closure;
use DateTimeImmutable;
use Illuminate\Support\Carbon;

/**
 * The clock of the demo seeders (DQ-677): every row a demo seeder writes, also through an Action that stamps now(), is dated by
 * the moment it runs at, so a re-seed writes the same timestamps. A nested moment returns to its outer one (a bare
 * Carbon::setTestNow() would drop back to the wall clock halfway through an outer moment). host() is the clock outside every
 * moment, for the few values that must stay ahead of the real time on the demo host (the expiry of an uploaded file).
 */
final class SeedClock
{
    private static int $depth = 0;

    /** The test clock outside the outermost moment; null when that was the wall clock. */
    private static ?CarbonImmutable $host = null;

    /**
     * @template T
     *
     * @param  Closure(): T  $write
     * @return T
     */
    public static function at(CarbonInterface $moment, Closure $write): mixed
    {
        $outer = Carbon::hasTestNow() ? Carbon::getTestNow() : null;

        if (self::$depth === 0) {
            self::$host = $outer === null ? null : CarbonImmutable::instance($outer);
        }

        self::$depth++;
        Carbon::setTestNow($moment);

        try {
            return $write();
        } finally {
            self::$depth--;
            Carbon::setTestNow($outer);
        }
    }

    /** The host's clock, also inside a moment. */
    public static function host(): CarbonImmutable
    {
        if (self::$depth === 0) {
            return CarbonImmutable::now();
        }

        return self::$host ?? CarbonImmutable::instance(new DateTimeImmutable);
    }
}
