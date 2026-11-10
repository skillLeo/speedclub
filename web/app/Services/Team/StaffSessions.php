<?php

namespace App\Services\Team;

use App\Models\Staff;
use App\Services\Admin\Members\DeviceLabel;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Staff browser sessions (ADM-40 "Sitzungen", ADM-51): rows of the database session table whose user_id is the staff id (StaffSession
 * makes `staff` the default guard, so the handler stores it; member rows carry 26-character ULIDs and never match). A session id is the
 * cookie's secret, so nothing here returns one: each session is named by `handle`, an HMAC of its id, and revoked by that handle.
 * No IP address is stored (NoIpDatabaseSessionHandler); the device is a coarse browser and system name from the user agent.
 *
 * Without the database session driver there is nothing to list; revokeAll() still ends every session through the credentials epoch.
 */
final class StaffSessions
{
    /**
     * Newest first.
     *
     * @return list<array{handle: string, current: bool, last_active_at: string, browser: string|null, os: string|null}>
     */
    public function list(Staff $staff, ?string $currentSessionId = null): array
    {
        if (! $this->databaseDriver()) {
            return [];
        }

        $current = $currentSessionId === null ? null : self::handle($currentSessionId);

        return array_values($this->table()->where('user_id', (string) $staff->getKey())->orderByDesc('last_activity')->limit(50)
            ->get(['id', 'user_agent', 'last_activity'])
            ->map(function (object $row) use ($current): array {
                $handle = self::handle((string) $row->id);
                $parsed = is_string($row->user_agent ?? null) && $row->user_agent !== '' ? DeviceLabel::parse($row->user_agent) : ['browser' => null, 'os' => null];

                return [
                    'handle' => $handle,
                    'current' => $current !== null && hash_equals($current, $handle),
                    'last_active_at' => CarbonImmutable::createFromTimestamp((int) $row->last_activity)->toIso8601String(),
                    'browser' => $parsed['browser'],
                    'os' => $parsed['os'],
                ];
            })->all());
    }

    /**
     * Ends the one session of $staff named by $handle. False when there is none.
     */
    public function revoke(Staff $staff, string $handle): bool
    {
        if (! $this->databaseDriver()) {
            return false;
        }

        $id = $this->table()->where('user_id', (string) $staff->getKey())->pluck('id')
            ->first(fn (mixed $id): bool => hash_equals(self::handle((string) $id), $handle));

        return $id !== null && $this->table()->where('id', $id)->delete() > 0;
    }

    /**
     * Deletes every session row of $staff but $exceptSessionId. The caller also rotates the credentials epoch (StaffCredentials), which
     * ends a session on any driver, and the remember token.
     */
    public function deleteAll(Staff $staff, ?string $exceptSessionId = null): int
    {
        $staff->forceFill(['remember_token' => Str::random(60)])->save();

        if (! $this->databaseDriver()) {
            return 0;
        }

        return $this->table()->where('user_id', (string) $staff->getKey())
            ->when($exceptSessionId !== null, fn ($query) => $query->where('id', '!=', $exceptSessionId))
            ->delete();
    }

    public static function handle(string $sessionId): string
    {
        return substr(hash_hmac('sha256', 'staff-session|'.$sessionId, config()->string('app.key')), 0, 32);
    }

    private function databaseDriver(): bool
    {
        return config('session.driver') === 'database';
    }

    private function table(): Builder
    {
        $connection = config('session.connection');

        return DB::connection(is_string($connection) ? $connection : null)->table(config()->string('session.table'));
    }
}
