<?php

namespace App\Support;

/**
 * PHP functions a shared host may disable (disable_functions). proc_open starts the commands of schedule:run and the database dump
 * of the backups; on a host without it the cron runs speedclub:schedule-inline instead, and the app's own backups stay off
 * (docs/DEPLOY.md §5, §12).
 */
final class HostFunctions
{
    private static ?bool $procOpen = null;

    public static function available(string $function): bool
    {
        $disabled = array_map(trim(...), explode(',', (string) ini_get('disable_functions')));

        return function_exists($function) && ! in_array($function, $disabled, true);
    }

    public static function procOpen(): bool
    {
        return self::$procOpen ?? self::available('proc_open');
    }

    /** Tests only: pretend proc_open is (un)available; null reads the host again. */
    public static function fakeProcOpen(?bool $available): void
    {
        self::$procOpen = $available;
    }
}
