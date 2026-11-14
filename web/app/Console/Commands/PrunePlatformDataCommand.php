<?php

namespace App\Console\Commands;

use App\Actions\Auth\DeleteUnverifiedAccount;
use App\Enums\UserStatus;
use App\Models\BusinessViewDay;
use App\Models\DeviceInstall;
use App\Models\IdempotencyKey;
use App\Models\KnownDevice;
use App\Models\LoginAttempt;
use App\Models\PasskeyChallenge;
use App\Models\SecurityEvent;
use App\Models\User;
use App\Models\VerificationCode;
use App\Services\Notifications\WebPushSessions;
use App\Services\Privacy\RetentionPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

#[Signature('speedclub:prune-platform')]
#[Description('Remove expired verification codes, e-mail sign-in codes, passkey ceremonies, idempotency keys, never-verified accounts, cache rows, sessions and their browser push subscriptions, and old daily business profile views')]
class PrunePlatformDataCommand extends Command
{
    private const UNVERIFIED_BATCH = 200;

    public function handle(DeleteUnverifiedAccount $unverifiedAccounts, WebPushSessions $webPush): int
    {
        $keys = IdempotencyKey::query()->where('expires_at', '<', now())->delete();

        // Spent codes stay for the retention period, because the hourly and daily limits count them (06_ADMIN_SPEC §4).
        $codes = VerificationCode::query()
            ->where('created_at', '<', now()->subHours(max(1, config()->integer('speedclub.verification.retention_hours'))))
            ->where('expires_at', '<', now())
            ->delete();

        // M4.6 (09 §8.1): e-mail codes and magic links of the passwordless flows. The hourly budgets and cooldowns of EmailCodes count rows
        // of the last hour only; a closed row stays the retention period (privacy policy "Wie lange wir Daten speichern") and then goes, consumed or expired.
        $attempts = LoginAttempt::query()
            ->where('created_at', '<', now()->subHours(max(1, config()->integer('speedclub.email_code.retention_hours'))))
            ->where(fn ($closed) => $closed->whereNotNull('consumed_at')->orWhere('expires_at', '<', now()))
            ->delete();
        // Passkey ceremonies live 5 minutes and are single use; a spent or expired one is of no use to anybody.
        $ceremonies = PasskeyChallenge::query()
            ->where('expires_at', '<', now())
            ->delete();

        $devices = KnownDevice::query()
            ->where('last_seen_at', '<', now()->subMonthsNoOverflow(app(RetentionPolicy::class)->value('known_devices_months')))
            ->delete();

        // M4.7 (09 §8.4): app installs unseen for as long as known devices are kept and without a token, and SET-21 rows after 12 months.
        $installs = DeviceInstall::query()
            ->where('last_seen_at', '<', now()->subMonthsNoOverflow(app(RetentionPolicy::class)->value('known_devices_months')))
            ->whereNotExists(fn ($tokens) => $tokens->selectRaw('1')->from('personal_access_tokens')->whereColumn('personal_access_tokens.device_install_id', 'device_installs.id'))
            ->delete();
        $events = SecurityEvent::query()
            ->where('created_at', '<', now()->subMonthsNoOverflow((int) app(RetentionPolicy::class)->fixed('security_events')))
            ->delete();

        $accounts = $this->pruneUnverifiedAccounts($unverifiedAccounts);

        // BIZ-03 reads the last views_days (30) days; the daily numbers stay views_retention_days (no personal data, one row per business
        // and day), then go. Never shorter than the window the dashboard sums.
        $keepDays = max(config()->integer('speedclub.businesses.views_days'), config()->integer('speedclub.businesses.views_retention_days'));
        $businessViews = BusinessViewDay::query()
            ->where('day', '<', CarbonImmutable::now(config()->string('speedclub.display_timezone'))->subDays($keepDays - 1)->toDateString())
            ->delete();

        $sessions = $this->pruneSessions();
        // SEC-414-02: after the sessions, so a subscription of a session that just expired goes in the same run.
        $subscriptions = $webPush->prune();

        $this->info("Pruned $keys idempotency keys, $codes verification codes, $attempts e-mail sign-in codes, $ceremonies passkey ceremonies, $devices known devices, $installs app installs, $events security events, $accounts never-verified accounts, {$this->pruneCache()} cache rows, $sessions sessions, $subscriptions browser push subscriptions and $businessViews daily business profile views.");

        return self::SUCCESS;
    }

    /**
     * Sanctioned accounts stay for their moderation trail, deactivated ones wait for their own 30-day hard delete. The
     * rest waits for the next run, to stay inside the cron window.
     */
    private function pruneUnverifiedAccounts(DeleteUnverifiedAccount $action): int
    {
        $accounts = User::withTrashed()
            ->whereNull('email_verified_at')
            ->where('status', UserStatus::Active)
            ->where('created_at', '<', now()->subDays(app(RetentionPolicy::class)->value('unverified_accounts_days')))
            ->limit(self::UNVERIFIED_BATCH)
            ->get();

        foreach ($accounts as $account) {
            $action->handle($account);
        }

        return $accounts->count();
    }

    /**
     * The database store removes an expired row only when the same key is read again, so the rate-limit keys derived
     * from IP addresses would stay. The privacy policy promises they do not.
     */
    private function pruneCache(): int
    {
        if (config('cache.default') !== 'database') {
            return 0;
        }

        $connection = config('cache.stores.database.connection');

        return DB::connection(is_string($connection) ? $connection : null)
            ->table(config()->string('cache.stores.database.table'))
            ->where('expiration', '<=', now()->getTimestamp())
            ->delete();
    }

    /**
     * Sessions hold an IP address and a user agent. The framework's own cleanup is a lottery on requests that start a
     * session, and the public pages do not.
     */
    private function pruneSessions(): int
    {
        if (config('session.driver') !== 'database') {
            return 0;
        }

        $connection = config('session.connection');

        return DB::connection(is_string($connection) ? $connection : null)
            ->table(config()->string('session.table'))
            ->where('last_activity', '<=', now()->subMinutes(config()->integer('session.lifetime'))->getTimestamp())
            ->delete();
    }
}
