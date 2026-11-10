<?php

namespace App\Health\Checks;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;
use Spatie\Health\Checks\Check;
use Spatie\Health\Checks\Result;
use Throwable;

/**
 * The newest spatie/laravel-backup archive on the first backup disk (backup.backup.destination.disks, folder backup.backup.name):
 * warning when there is none yet (backups are an open owner action) or the newest is older than 26 hours, failed after 72 hours.
 */
class LastBackupCheck extends Check
{
    public function run(): Result
    {
        $disks = config('backup.backup.destination.disks', ['local']);
        $disk = is_array($disks) && is_string($disks[0] ?? null) ? $disks[0] : 'local';
        $folder = (string) config('backup.backup.name', config('app.name'));

        try {
            $files = array_filter(Storage::disk($disk)->files($folder), fn (string $file): bool => str_ends_with($file, '.zip'));
            $newest = array_reduce($files, fn (?int $carry, string $file): int => max($carry ?? 0, Storage::disk($disk)->lastModified($file)), null);
        } catch (Throwable) {
            return Result::make('unknown')->meta(['found' => false])->warning('The backup disk could not be read.');
        }

        if ($newest === null) {
            return Result::make('none')->meta(['found' => false])->warning('No backup yet.');
        }

        $at = Carbon::createFromTimestamp($newest);
        $hours = (int) $at->diffInHours(now(), true);
        $result = Result::make($at->toIso8601String())->meta(['found' => true, 'at' => $at->toIso8601String(), 'count' => count($files)]);

        return match (true) {
            $hours >= 72 => $result->failed("The newest backup is $hours hours old."),
            $hours >= 26 => $result->warning("The newest backup is $hours hours old."),
            default => $result->ok(),
        };
    }
}
