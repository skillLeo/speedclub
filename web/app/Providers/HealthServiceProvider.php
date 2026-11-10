<?php

namespace App\Providers;

use App\Health\Checks\AiProviderCheck;
use App\Health\Checks\AuditChainCheck;
use App\Health\Checks\DiskSpaceCheck;
use App\Health\Checks\FailedJobsCheck;
use App\Health\Checks\GdWebpCheck;
use App\Health\Checks\LastBackupCheck;
use App\Health\Checks\MailConfigCheck;
use App\Health\Checks\PhpEnvironmentCheck;
use App\Health\Checks\PusherCheck;
use App\Health\Checks\QueueBacklogCheck;
use App\Health\Checks\StorageLinkCheck;
use App\Support\Backups\BackupEncryption;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;
use Spatie\Backup\Events\BackupManifestWasCreated;
use Spatie\Backup\Events\DumpingDatabase;
use Spatie\Health\Checks\Checks\CacheCheck;
use Spatie\Health\Checks\Checks\DatabaseCheck;
use Spatie\Health\Checks\Checks\DebugModeCheck;
use Spatie\Health\Checks\Checks\EnvironmentCheck;
use Spatie\Health\Checks\Checks\OptimizedAppCheck;
use Spatie\Health\Checks\Checks\QueueCheck;
use Spatie\Health\Checks\Checks\ScheduleCheck;
use Spatie\Health\Facades\Health;

/**
 * ADM-48 (06_ADMIN_SPEC §3 System, m3.6 §1): DB, cache, queue (the spatie test job and the backlog), failed jobs, cron heartbeat, disk,
 * storage link, GD WebP, PHP version and extensions, mail config, Pusher and AI provider reachability, last backup, audit chain.
 * Shared-hosting safe: nothing shells out (DiskSpaceCheck uses PHP's own functions instead of UsedDiskSpaceCheck's `df`), and the two
 * network checks stop after 3 seconds. No check result carries a secret. `health:check` runs every five minutes (routes/console.php).
 */
class HealthServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        $checks = [
            DatabaseCheck::new(),
            CacheCheck::new(),
            QueueCheck::new()->failWhenHealthJobTakesLongerThanMinutes(5),
            QueueBacklogCheck::new(),
            FailedJobsCheck::new(),
            ScheduleCheck::new()->heartbeatMaxAgeInMinutes(3),
            DiskSpaceCheck::new(),
            StorageLinkCheck::new(),
            GdWebpCheck::new(),
            PhpEnvironmentCheck::new(),
            MailConfigCheck::new(),
            PusherCheck::new(),
            AiProviderCheck::new(),
            LastBackupCheck::new(),
            AuditChainCheck::new(),
        ];

        if ($this->app->isProduction()) {
            $checks[] = DebugModeCheck::new();
            $checks[] = EnvironmentCheck::new();
            $checks[] = OptimizedAppCheck::new();
        }

        Health::checks($checks);

        // SF-3 (ADR-250): a production backup without BACKUP_ARCHIVE_PASSWORD fails before the first dump (or, files only, before the
        // zip) inside the package's try, so the run ends in BackupHasFailed (mail), a non-zero exit and no archive on the disk.
        Event::listen([DumpingDatabase::class, BackupManifestWasCreated::class], function (): void {
            BackupEncryption::ensure();
        });
    }
}
