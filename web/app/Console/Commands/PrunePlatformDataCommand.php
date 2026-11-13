<?php

namespace App\Console\Commands;

use App\Actions\Auth\DeleteUnverifiedAccount;
use App\Enums\UserStatus;
use App\Models\DeviceInstall;
use App\Models\IdempotencyKey;
use App\Models\KnownDevice;
use App\Models\SecurityEvent;
use App\Models\User;
use App\Models\VerificationCode;
use App\Services\Privacy\RetentionPolicy;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

#[Signature('speedclub:prune-platform')]
#[Description('Remove expired verification codes, idempotency keys, never-verified accounts, cache rows and sessions')]
class PrunePlatformDataCommand extends Command
{
    private const UNVERIFIED_BATCH = 200;

    public function handle(DeleteUnverifiedAccount $unverifiedAccounts): int
    {
        $keys = IdempotencyKey::query()->where('expires_at', '<', now())->delete();

        // Spent codes stay for the retention period, because the hourly and daily limits count them (06_ADMIN_SPEC §4).
        $codes = VerificationCode::query()
            ->where('created_at', '<', now()->subHours(max(1, config()->integer('speedclub.verification.retention_hours'))))
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

        $this->info("Pruned $keys idempotency keys, $codes verification codes, $devices known devices, $installs app installs, $events security events, $accounts never-verified accounts, {$this->pruneCache()} cache rows and {$this->pruneSessions()} sessions.");

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
