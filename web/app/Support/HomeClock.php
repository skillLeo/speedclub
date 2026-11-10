<?php

namespace App\Support;

use Carbon\CarbonImmutable;

/**
 * The reference time of Home (M2.2 review B1): the rank decay and the 7, 14 and 30-day windows of Aktive Mitglieder, Beliebte Mods and
 * engagement read it instead of the wall clock. speedclub.home.clock is empty in production and staging (the real now); locally it is
 * DemoSeeder::NOW, so the demo, whose story ends at that moment, looks alive and the visual matrix stays deterministic (ADR-166). Only
 * Home reads it: no other part of the app, and no timestamp it writes, moves.
 */
final class HomeClock
{
    public static function now(): CarbonImmutable
    {
        $clock = config('speedclub.home.clock');

        return is_string($clock) && $clock !== '' ? CarbonImmutable::parse($clock, 'UTC') : CarbonImmutable::now();
    }
}
