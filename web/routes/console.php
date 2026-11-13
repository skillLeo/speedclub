<?php

use App\Console\Commands\AuditExportCommand;
use App\Console\Commands\AuditRetentionCommand;
use App\Console\Commands\AuditVerifyCommand;
use App\Console\Commands\CheckPushReceiptsCommand;
use App\Console\Commands\EventHousekeepingCommand;
use App\Console\Commands\ExpireApprovalsCommand;
use App\Console\Commands\GenerateSitemapCommand;
use App\Console\Commands\KpiSnapshotCommand;
use App\Console\Commands\LiftExpiredSuspensionsCommand;
use App\Console\Commands\PruneAiDataCommand;
use App\Console\Commands\PruneDataExportsCommand;
use App\Console\Commands\PruneDeletedAccountsCommand;
use App\Console\Commands\PruneMediaCommand;
use App\Console\Commands\PruneModerationCasesCommand;
use App\Console\Commands\PruneNotificationsCommand;
use App\Console\Commands\PruneOgImagesCommand;
use App\Console\Commands\PrunePlatformDataCommand;
use App\Console\Commands\PrunePrivacyRequestsCommand;
use App\Console\Commands\PruneSupportTicketsCommand;
use App\Console\Commands\PruneVehiclesCommand;
use App\Console\Commands\RankHomeFeedCommand;
use App\Console\Commands\SendEventRemindersCommand;
use App\Console\Commands\SendHuAuRemindersCommand;
use App\Console\Commands\SendMaintenanceRemindersCommand;
use App\Console\Commands\SendMessageDigestCommand;
use App\Console\Commands\SendQrMilestonesCommand;
use App\Console\Commands\SendSavedBuildsDigestCommand;
use App\Jobs\Catalog\PruneCatalogImports;
use App\Services\Maintenance\MaintenanceReminders;
use App\Support\HostFunctions;
use Illuminate\Support\Facades\Schedule;
use Laravel\Sanctum\Console\Commands\PruneExpired;
use Spatie\Backup\Commands\BackupCommand;
use Spatie\Backup\Commands\CleanupCommand;
use Spatie\Backup\Commands\MonitorCommand;
use Spatie\Health\Commands\DispatchQueueCheckJobsCommand;
use Spatie\Health\Commands\RunHealthChecksCommand;
use Spatie\Health\Commands\ScheduleCheckHeartbeatCommand;
use Spatie\Health\Models\HealthCheckResultHistoryItem;

// Cron: * * * * * cd /path/to/speedclub && php artisan schedule:run >> /dev/null 2>&1 (05_ARCHITECTURE §11); on a host without
// proc_open: php artisan speedclub:schedule-inline instead (App\Console\Commands\ScheduleInlineCommand, DEPLOY §5).
// All times UTC unless an entry names its zone. Entries for backups and reminders join when those features exist.
// The cron heartbeat that speedclub:doctor reads.
Schedule::command(ScheduleCheckHeartbeatCommand::class)->everyMinute();
Schedule::command(DispatchQueueCheckJobsCommand::class)->everyMinute();
Schedule::command(RunHealthChecksCommand::class)->everyFiveMinutes();

Schedule::command(PrunePlatformDataCommand::class)->hourly();
Schedule::command(PruneExpired::class, ['--hours' => 24])->hourly();

Schedule::command(AuditExportCommand::class)->dailyAt('02:00');
Schedule::command(AuditVerifyCommand::class)->dailyAt('02:00');
Schedule::command(AuditRetentionCommand::class)->dailyAt('02:30');
Schedule::command(PruneMediaCommand::class)->daily();
Schedule::command(PruneVehiclesCommand::class)->daily();
// ADM-17: import files after 30 days, stalled applies restarted, imports of an ended approval back to analysed (M3.3).
Schedule::job(new PruneCatalogImports)->daily();
// ADM-45: GDPR request files and rows after the retention period (M3.6).
Schedule::command(PrunePrivacyRequestsCommand::class)->dailyAt('04:20');
// Moderation cases after 36 months unless open, appealed or recently decided (ADR-239); AI call logs after 90 days (ADR-242).
Schedule::command(PruneModerationCasesCommand::class)->dailyAt('04:30');
Schedule::command(PruneAiDataCommand::class)->dailyAt('04:40');
Schedule::command(PruneOgImagesCommand::class)->dailyAt('03:00');
Schedule::command(GenerateSitemapCommand::class)->dailyAt('03:30');
Schedule::command('model:prune', ['--model' => [HealthCheckResultHistoryItem::class]])->daily();

// M2.2 Home and notifications. The saved-builds digest runs Monday 09:00 in Europe/Berlin, whatever UTC says.
Schedule::command(RankHomeFeedCommand::class)->hourly()->withoutOverlapping(10);
Schedule::command(CheckPushReceiptsCommand::class)->everyFifteenMinutes();
Schedule::command(PruneNotificationsCommand::class)->dailyAt('03:15');
Schedule::command(SendSavedBuildsDigestCommand::class)->weeklyOn(1, '09:00')->timezone('Europe/Berlin');

// M2.4: the opt-in e-mail digest of messages unread for more than 12 h, daily 18:00 in Europe/Berlin.
Schedule::command(SendMessageDigestCommand::class)->dailyAt('18:00')->timezone('Europe/Berlin');

// M2.5 data rights: export files go after their 7 days (hourly), accounts are hard-deleted within 30 days of the request (daily).
Schedule::command(PruneDataExportsCommand::class)->hourly();
Schedule::command(PruneDeletedAccountsCommand::class)->dailyAt('04:00');
Schedule::command(PruneSupportTicketsCommand::class)->dailyAt('04:10');

// M2.7 signature features, daily 09:00 in Europe/Berlin (outside quiet hours): QR scan milestones from the day counts, and the HU/AU
// reminder 30 days before the due month. Both tell once (vehicles.qr_milestone, vehicles.hu_au_reminded_for) and stop after 40 s.
Schedule::command(SendQrMilestonesCommand::class)->dailyAt('09:00')->timezone('Europe/Berlin');
Schedule::command(SendHuAuRemindersCommand::class)->dailyAt('09:00')->timezone('Europe/Berlin');
// M4.13 (09 §8.8): maintenance reminders at the members' lead times, daily 09:00 Europe/Berlin, once per stage (maintenance_reminders),
// stops after 40 s. While `maintenance` is on it tells the HU/AU too and the M2.7 command above stays silent; while off, the reverse.
Schedule::command(SendMaintenanceRemindersCommand::class)->dailyAt(MaintenanceReminders::HOUR)->timezone('Europe/Berlin');

// M2.6: timed suspensions and restrictions end when their date passes, so lists filtering on status = active show the member again.
Schedule::command(LiftExpiredSuspensionsCommand::class)->everyFifteenMinutes();

// M4.12 events (09 §8.7): reminders 24 h and 2 h before the start for going members, every five minutes (each run stops after 40 s and
// tells nobody twice); daily upkeep: retention (cancelled/rejected 12 months, past 24), waitlists after deleted accounts, sample dates.
Schedule::command(SendEventRemindersCommand::class)->everyFiveMinutes()->withoutOverlapping(10);
Schedule::command(EventHousekeepingCommand::class)->dailyAt('03:50');

// M3.1 admin: four-eyes requests end after 24 hours (ADR-214); the WAU tile's rolling seven-day count of the German day before (ADR-216).
Schedule::command(ExpireApprovalsCommand::class)->hourly();
Schedule::command(KpiSnapshotCommand::class)->dailyAt('00:05')->timezone('Europe/Berlin');
// Backups (ADR-250, DEPLOY §12): clean first, then a new archive; the monitor mails when the newest is too old or the disk too full.
// The dump needs proc_open: on a host without it (speedclub:schedule-inline) the host's own backups apply, and these stay off.
Schedule::command(CleanupCommand::class)->dailyAt('01:30')->withoutOverlapping()->when(fn (): bool => HostFunctions::procOpen());
Schedule::command(BackupCommand::class)->dailyAt('01:30')->withoutOverlapping()->when(fn (): bool => HostFunctions::procOpen());
Schedule::command(MonitorCommand::class)->dailyAt('07:00')->when(fn (): bool => HostFunctions::procOpen());

// Last: events run one after the other, and the worker may use up to 50 s of the minute. The lock expires after 2
// minutes, so a worker the host killed cannot stop the queue until the default 24-hour expiry.
Schedule::command('queue:work --stop-when-empty --max-time=50 --tries=3')->everyMinute()->withoutOverlapping(2);
