<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * The created_at of a pivot row (a follow, a block, a save) as ISO 8601. A pivot casts it only when it knows its timestamps, so it can
 * arrive as a string from the database. The column is NOT NULL (migration 2026_11_08_100000), so anything else is an empty string.
 */
final class PivotTime
{
    public static function iso(mixed $value): string
    {
        return match (true) {
            $value instanceof DateTimeInterface => CarbonImmutable::instance($value)->toIso8601String(),
            is_string($value) && $value !== '' => CarbonImmutable::parse($value)->toIso8601String(),
            default => '',
        };
    }
}
