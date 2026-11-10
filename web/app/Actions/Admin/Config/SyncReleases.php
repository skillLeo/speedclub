<?php

namespace App\Actions\Admin\Config;

use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Releases\ReleaseRegister;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * ADM-38 "Aus RELEASES.md übernehmen" (`releases.manage`): what `php artisan speedclub:releases-sync` does, from the admin. Idempotent
 * by version + build + channel + platform; ReleaseRegister audits `release.synced` when anything changed. Null when the register file
 * is missing (a host without the docs folder).
 */
final class SyncReleases
{
    public function __construct(private readonly ReleaseRegister $register) {}

    /**
     * @return array{created: int, updated: int, unchanged: int, duplicates: int}|null
     *
     * @throws AuthorizationException
     */
    public function handle(Staff $staff, ?string $path = null): ?array
    {
        StaffAtoms::ensure($staff, 'releases.manage');
        $path ??= config()->string('speedclub.content.releases_path');

        if (! is_file($path) || ! is_readable($path)) {
            return null;
        }

        return $this->register->sync((string) file_get_contents($path));
    }
}
