<?php

use App\Console\Commands\AuditExportCommand;
use App\Console\Commands\AuditRetentionCommand;
use App\Console\Commands\AuditVerifyCommand;
use App\Console\Commands\BadgesNightlyCommand;
use App\Console\Commands\BuildScoreNightlyCommand;
use App\Console\Commands\CarOfTheDayCommand;
use App\Console\Commands\CheckPushReceiptsCommand;
use App\Console\Commands\DexNightlyCommand;
use App\Console\Commands\EventHousekeepingCommand;
use App\Console\Commands\ExpireApprovalsCommand;
use App\Console\Commands\GenerateSitemapCommand;
use App\Console\Commands\GenerateWrappedCommand;
use App\Console\Commands\KpiSnapshotCommand;
use App\Console\Commands\LiftExpiredSuspensionsCommand;
use App\Console\Commands\PruneAiDataCommand;
use App\Console\Commands\PruneCrewsCommand;
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
use App\Console\Commands\PruneViewsCommand;
use App\Console\Commands\PruneWrappedCardsCommand;
use App\Console\Commands\PurgeShopProductsCommand;
use App\Console\Commands\RankHomeFeedCommand;
use App\Console\Commands\SendEventRemindersCommand;
use App\Console\Commands\SendHuAuRemindersCommand;
use App\Console\Commands\SendMaintenanceRemindersCommand;
use App\Console\Commands\SendMessageDigestCommand;
use App\Console\Commands\SendNearbyEventsDigestCommand;
use App\Console\Commands\SendPlanDuePromptsCommand;
use App\Console\Commands\SendQrMilestonesCommand;
use App\Console\Commands\SendSavedBuildsDigestCommand;
use App\Console\Commands\SendSpotAlertsCommand;
use App\Console\Commands\SendWeeklyRecapsCommand;
use App\Console\Commands\SummariseForumThreadsCommand;
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
// R4-2.3: deleted crews after their retention, with logo and cover; never while a moderation case or appeal holds them.
Schedule::command(PruneCrewsCommand::class)->daily();
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
// M5.6 "Neue Treffen in deiner Nähe" (m5.6-contract §6): weekly from Thursday 18:00 Europe/Berlin; the command works only inside its
// window (until Friday 10:00), stops after 40 s a run and resumes, and retries pushes that waited for the end of quiet hours.
Schedule::command(SendNearbyEventsDigestCommand::class)->everyTenMinutes()->days([4, 5])->timezone('Europe/Berlin')->withoutOverlapping(10);

// M5.9b STREET DEX (m5.9b contract §4, §6): the grouped owner alert every three hours (Europe/Berlin 00, 03, … 21; pushes only outside
// 22–08 and once a day per member across the gift social types), and the night's upkeep (numbers, rarity, stats, set progress) every ten
// minutes from 02:00 to 05:50 until the day's steps are done. Both stop after 40 s, resume where they stopped and hold a cache lock.
Schedule::command(SendSpotAlertsCommand::class)->cron('0 */3 * * *')->timezone('Europe/Berlin')->withoutOverlapping(10);
// M5.9c Build Score (m5.9c contract §3): every score again and the ranks by generation and Bundesland, every five minutes from 00:30 to
// 01:55 Europe/Berlin until the night is done (before dex:nightly reads the totals). Stops after 40 s, resumes, holds a cache lock.
Schedule::command(BuildScoreNightlyCommand::class)->everyFiveMinutes()->between('00:30', '01:55')->timezone('Europe/Berlin')->withoutOverlapping(10);
Schedule::command(DexNightlyCommand::class)->everyTenMinutes()->between('02:00', '05:59')->timezone('Europe/Berlin')->withoutOverlapping(10);
// M5.9d supporting system (m5.9d contract §2, §3): the retroactive badge run every ten minutes 03:05–05:55 Europe/Berlin (offset by
// five minutes from the Dex runs, after the Build Score night; it may overlap a long Dex night, which is harmless: every value it reads
// is current, and the next night catches up, CR-P5G-22) until every member is done; the Car of the Day picked from 17:55 and published at
// 18:00, every five minutes until 23:55 so a late cron catches up. Both stop after 40 s, resume and hold a cache lock.
Schedule::command(BadgesNightlyCommand::class)->cron('5-55/10 3-5 * * *')->timezone('Europe/Berlin')->withoutOverlapping(10);
Schedule::command(CarOfTheDayCommand::class)->everyFiveMinutes()->between('17:55', '23:55')->timezone('Europe/Berlin')->withoutOverlapping(10);
// M5.9e Season Wrapped (m5.9e contract §2): every season released within wrapped.generate_days_before days ("due"), every ten minutes
// from 06:00 to 07:55 Europe/Berlin (after the Build Score and Dex nights) until the day's pass is done. Stops after 40 s, resumes at its
// cursor (kept per season and release, so an unfinished pass continues the next day; a released season stays due until its first full
// pass is done, CR-P5G-05/06), holds a cache lock per season. The card images of removed Wrapped go daily.
Schedule::command(GenerateWrappedCommand::class, ['due'])->everyTenMinutes()->between('06:00', '07:55')->timezone('Europe/Berlin')->withoutOverlapping(10);
Schedule::command(PruneWrappedCardsCommand::class)->dailyAt('04:50')->timezone('Europe/Berlin');
// M5.5 Shop (m5.5-contract §1): products deleted in ADM-66 longer than 30 days ago go for good, with their photos (< 40 s, chunked).
Schedule::command(PurgeShopProductsCommand::class)->dailyAt('04:55')->timezone('Europe/Berlin')->withoutOverlapping(10);
// M5.7 Engagement (m5.7-contract §7): raw view events after 90 days (the daily totals stay), past view salts, old weekly recaps and
// engagement push claims; batches, stops after 40 s, deletes only.
Schedule::command(PruneViewsCommand::class)->dailyAt('04:15')->timezone('Europe/Berlin')->withoutOverlapping(10);
// The day's view salt goes right after the day ends (review NH: "nach Ablauf des Tages" literally), not only at the first view or at 04:15.
Schedule::command(PruneViewsCommand::class, ['--salts'])->dailyAt('00:05')->timezone('Europe/Berlin');
// M5.9 (m5.9-contract §2.3): the KI-Zusammenfassung of long forum threads, every ten minutes 06:00–23:50 Europe/Berlin while
// ai.forum_summary is on and a provider key exists; stale ones are dropped first. ≤ 40 s, cache lock, a re-run writes nothing new.
Schedule::command(SummariseForumThreadsCommand::class)->everyTenMinutes()->between('06:00', '23:50')->timezone('Europe/Berlin')->withoutOverlapping(10);
// M5.7 build prompts (m5.7-contract §4.2): plans whose target month arrived (this or last month), at most one prompt per owner and week,
// every ten minutes 10:00–11:55 Europe/Berlin until the day's owners are done. M5.7 weekly recap (§6): Sundays from 18:00 Europe/Berlin,
// every five minutes until 21:55 so a late cron catches up; once per member and week. Both stop after 40 s, resume and hold a cache lock.
Schedule::command(SendPlanDuePromptsCommand::class)->everyTenMinutes()->between('10:00', '11:55')->timezone('Europe/Berlin')->withoutOverlapping(10);
Schedule::command(SendWeeklyRecapsCommand::class)->sundays()->everyFiveMinutes()->between('18:00', '21:55')->timezone('Europe/Berlin')->withoutOverlapping(10);

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
