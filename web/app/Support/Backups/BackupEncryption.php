<?php

namespace App\Support\Backups;

/**
 * ADR-250 (code review phase-3-final SF-3): a production archive is always AES-256 encrypted. Without BACKUP_ARCHIVE_PASSWORD the
 * backup refuses to start (HealthServiceProvider listens to the package's first events of a run, ahead of the dump and the zip), so
 * spatie's own failure path deletes the temporary directory, mails the failure and backup:run exits non-zero. The doctor reports the
 * same condition as a blocker. Other environments keep running (a warning in the doctor), so a local or staging run stays possible.
 */
final class BackupEncryption
{
    public static function missing(): bool
    {
        return trim((string) config('backup.backup.password', '')) === '';
    }

    public static function required(): bool
    {
        return app()->environment('production');
    }

    /**
     * @throws UnencryptedBackupRefused
     */
    public static function ensure(): void
    {
        if (self::required() && self::missing()) {
            throw new UnencryptedBackupRefused('BACKUP_ARCHIVE_PASSWORD is empty: a production backup is never written unencrypted (ADR-250, docs/DEPLOY.md §12).');
        }
    }
}
