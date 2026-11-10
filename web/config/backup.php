<?php

use Spatie\Backup\Notifications\Notifiable;
use Spatie\Backup\Notifications\Notifications\BackupHasFailedNotification;
use Spatie\Backup\Notifications\Notifications\BackupWasSuccessfulNotification;
use Spatie\Backup\Notifications\Notifications\CleanupHasFailedNotification;
use Spatie\Backup\Notifications\Notifications\CleanupWasSuccessfulNotification;
use Spatie\Backup\Notifications\Notifications\HealthyBackupWasFoundNotification;
use Spatie\Backup\Notifications\Notifications\UnhealthyBackupWasFoundNotification;
use Spatie\Backup\Tasks\Cleanup\Strategies\DefaultStrategy;
use Spatie\Backup\Tasks\Monitor\HealthChecks\MaximumAgeInDays;
use Spatie\Backup\Tasks\Monitor\HealthChecks\MaximumStorageInMegabytes;
use Spatie\DbDumper\Compressors\GzipCompressor;

/*
 * spatie/laravel-backup for a shared host (docs/DEPLOY.md §12; cron: backup:clean + backup:run daily at 01:30, backup:monitor daily).
 *
 * What goes in: the database (the dump keeps the audit chain's triggers) and the two storage roots with member files: storage/app/public
 * (photos, OG cards, brand assets) and storage/app/private (chat photos, private originals, exports, evidence, audit exports).
 * Never: .env (kept separately in a password manager or the host's secret store), the code (the package zip), and the backups
 * themselves. The archive goes to the `backups` disk (filesystems.php; BACKUP_DISK_ROOT, default storage/app/backups, a sibling of the
 * two sources, never inside them) or to another disk named in BACKUP_DISK, e.g. an EU S3 bucket. Encrypted with
 * BACKUP_ARCHIVE_PASSWORD (AES-256); without it the doctor warns. Failures and an unhealthy backup are mailed to BACKUP_MAIL_TO,
 * else HEALTH_TO_ADDRESS, else the support address. Copies are kept 30 days (the privacy policy's target).
 *
 * tests/Feature/Console/BackupConfigTest.php checks that no source is .env or the destination.
 */
$disk = env('BACKUP_DISK', 'backups');
$name = env('BACKUP_NAME', 'speedclub');

return [

    'backup' => [
        'name' => $name,

        'source' => [
            'files' => [
                'include' => [
                    storage_path('app/public'),
                    storage_path('app/private'),
                ],

                // Belt and braces: none of these is inside the sources above, and the test keeps it that way.
                'exclude' => [
                    base_path('.env'),
                    storage_path('app/backups'),
                    storage_path('app/backup-temp'),
                    storage_path('framework'),
                    storage_path('logs'),
                ],

                'follow_links' => false,
                'ignore_unreadable_directories' => false,
                // Paths in the zip start at storage/ (app/public/…, app/private/…), as the restore test unpacks them.
                'relative_path' => storage_path(),
            ],

            'databases' => [
                env('DB_CONNECTION', 'mysql'),
            ],
        ],

        'database_dump_compressor' => GzipCompressor::class,
        'database_dump_file_timestamp_format' => null,
        'database_dump_filename_base' => 'database',
        'database_dump_file_extension' => '',

        'destination' => [
            'compression_method' => ZipArchive::CM_DEFAULT,
            'compression_level' => 6,
            'filename_prefix' => '',
            'disks' => [$disk],
            'continue_on_failure' => false,
        ],

        'temporary_directory' => storage_path('app/backup-temp'),

        'password' => env('BACKUP_ARCHIVE_PASSWORD'),
        'encryption' => 'aes256',

        'verify_backup' => true,
        'tries' => 1,
        'retry_delay' => 0,
    ],

    'notifications' => [
        // Only what needs a person: a failed run or cleanup, and a backup the monitor finds too old or too big.
        'notifications' => [
            BackupHasFailedNotification::class => ['mail'],
            UnhealthyBackupWasFoundNotification::class => ['mail'],
            CleanupHasFailedNotification::class => ['mail'],
            BackupWasSuccessfulNotification::class => [],
            HealthyBackupWasFoundNotification::class => [],
            CleanupWasSuccessfulNotification::class => [],
        ],

        'notifiable' => Notifiable::class,

        'mail' => [
            'to' => env('BACKUP_MAIL_TO') ?: (env('HEALTH_TO_ADDRESS') ?: env('SUPPORT_EMAIL', 'support@speedclub.de')),

            'from' => [
                'address' => env('MAIL_FROM_ADDRESS', 'noreply@speedclub.de'),
                'name' => env('MAIL_FROM_NAME', 'SPEED CLUB'),
            ],
        ],

        'slack' => ['webhook_url' => '', 'channel' => null, 'username' => null, 'icon' => null],
        'discord' => ['webhook_url' => '', 'username' => '', 'avatar_url' => ''],
        'webhook' => ['url' => ''],
    ],

    'log_channel' => null,

    'monitor_backups' => [
        [
            'name' => $name,
            'disks' => [$disk],
            'health_checks' => [
                MaximumAgeInDays::class => 1,
                MaximumStorageInMegabytes::class => (int) env('BACKUP_MAX_MEGABYTES', 5000),
            ],
        ],
    ],

    'cleanup' => [
        'strategy' => DefaultStrategy::class,

        // 7 days of every backup, then one a day up to day 30; nothing older (the newest is never deleted).
        'default_strategy' => [
            'keep_all_backups_for_days' => 7,
            'keep_daily_backups_for_days' => 23,
            'keep_weekly_backups_for_weeks' => 0,
            'keep_monthly_backups_for_months' => 0,
            'keep_yearly_backups_for_years' => 0,
            'delete_oldest_backups_when_using_more_megabytes_than' => (int) env('BACKUP_MAX_MEGABYTES', 5000),
        ],

        'tries' => 1,
        'retry_delay' => 0,
    ],

];
