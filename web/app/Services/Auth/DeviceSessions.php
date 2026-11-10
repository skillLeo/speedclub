<?php

namespace App\Services\Auth;

use App\Enums\SessionKind;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Support\Auth\DeviceSession;
use Carbon\CarbonImmutable;
use Illuminate\Database\ConnectionInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * SET-06: the member's app tokens (one per install, ADR-184) and browser sessions (database driver only). Ending a device ends every
 * token of that install, rotation leftovers included, and removes its push token (ADR-192, ADR-197).
 */
final class DeviceSessions
{
    /**
     * Newest first; the device this request comes from first of all.
     *
     * @return list<DeviceSession>
     */
    public function list(User $user, Request $request): array
    {
        $rows = [...$this->tokens($user, $request), ...$this->browsers($user, $request)];

        usort($rows, fn (DeviceSession $a, DeviceSession $b): int => [$b->current, $b->lastUsedAt->getTimestamp()] <=> [$a->current, $a->lastUsedAt->getTimestamp()]);

        return $rows;
    }

    /**
     * Ends one device or browser. False when the id is unknown or not this member's.
     */
    public function revoke(User $user, string $id): bool
    {
        if (str_starts_with($id, 't') && ctype_digit(substr($id, 1))) {
            $token = $user->tokens()->whereKey((int) substr($id, 1))->first();

            if (! $token instanceof PersonalAccessToken) {
                return false;
            }

            $this->endDevice($user, $token);
            // Whatever that device read stops working too, such as an export link (SEC-P2-02).
            CredentialEpoch::rotate($user);

            return true;
        }

        if (str_starts_with($id, 'w')) {
            foreach ($this->sessionIds($user) as $sessionId) {
                if (hash_equals($this->browserId($sessionId), $id)) {
                    $this->sessionTable()->where('id', $sessionId)->delete();
                    CredentialEpoch::rotate($user);

                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Every device and browser but the one of this request. Push tokens of other installs go too.
     *
     * @return array{devices: int, sessions: int}
     */
    public function revokeOthers(User $user, Request $request): array
    {
        $current = $this->currentToken($user);
        $keep = $current?->onSameDevice()->pluck('id')->all() ?? [];
        $device = $current?->deviceId();

        $devices = $user->tokens()->whereNotIn('id', $keep)->delete();
        CredentialEpoch::rotate($user);

        // Push tokens of other installs. A legacy token of this request (no device_id, older app builds) cannot be told from its
        // push token, so push tokens without an install id stay then; any other install id goes (review nit 17).
        $user->pushTokens()
            ->when($device !== null, fn ($query) => $query->where(fn ($other) => $other->whereNull('device_id')->orWhere('device_id', '!=', $device)))
            ->when($current !== null && $device === null, fn ($query) => $query->whereNotNull('device_id'))
            ->delete();

        return ['devices' => $devices, 'sessions' => $this->endOtherBrowsers($user, $request)];
    }

    /**
     * Every browser session of the member but this request's, e.g. after a password change: Sanctum would refuse them at their next
     * request anyway, and SET-06 must not list them meanwhile (review nit 15).
     */
    public function endOtherBrowsers(User $user, Request $request): int
    {
        if (! $this->hasSessionTable()) {
            return 0;
        }

        $sessionId = $this->currentToken($user) !== null || ! $request->hasSession() ? null : $request->session()->getId();

        return $this->sessionTable()
            ->where('user_id', $user->getKey())
            ->when($sessionId !== null, fn ($query) => $query->where('id', '!=', $sessionId))
            ->delete();
    }

    /**
     * Whether the id names the device of this request.
     */
    public function isCurrent(User $user, string $id, Request $request): bool
    {
        $current = $this->currentToken($user);

        // By install, not by row: right after a rotation the device has two tokens, and the replaced one is this device too (nit 16).
        if ($current !== null && str_starts_with($id, 't') && ctype_digit(substr($id, 1))) {
            $token = $user->tokens()->whereKey((int) substr($id, 1))->first();

            return $token instanceof PersonalAccessToken && $this->deviceKey($token) === $this->deviceKey($current);
        }

        foreach ($this->list($user, $request) as $row) {
            if ($row->id === $id) {
                return $row->current;
            }
        }

        return false;
    }

    /**
     * The stored token of this request; null for a cookie session (Sanctum's TransientToken).
     */
    private function currentToken(User $user): ?PersonalAccessToken
    {
        $token = $user->currentAccessToken();

        return $token instanceof PersonalAccessToken && $token->exists ? $token : null;
    }

    private function endDevice(User $user, PersonalAccessToken $token): void
    {
        $device = $token->deviceId();
        $token->onSameDevice()->delete();

        if ($device !== null) {
            $user->pushTokens()->where('device_id', $device)->delete();
        }
    }

    /**
     * One row per install: right after a rotation the replaced token lives two more minutes (ADR-173), and it is the same device.
     *
     * @return list<DeviceSession>
     */
    private function tokens(User $user, Request $request): array
    {
        $current = $this->currentToken($user);
        $currentId = $current?->getKey();
        $currentDevice = $current === null ? null : $this->deviceKey($current);

        /** @var iterable<PersonalAccessToken> $tokens */
        $tokens = $user->tokens()
            ->where(fn ($query) => $query->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();

        $rows = [];

        foreach ($tokens as $token) {
            $key = $this->deviceKey($token);

            if (isset($rows[$key])) {
                continue;
            }

            $platform = $token->getAttribute('platform');
            $version = $token->getAttribute('app_version');
            $used = $token->getAttribute('last_used_at') ?? $token->getAttribute('created_at');

            $rows[$key] = new DeviceSession(
                't'.$token->getKey(),
                SessionKind::App,
                $token->deviceName(),
                $platform instanceof \BackedEnum ? (string) $platform->value : null,
                is_string($version) ? $version : null,
                CarbonImmutable::parse($used ?? now()),
                $token->getKey() === $currentId || $key === $currentDevice,
            );
        }

        return array_values($rows);
    }

    /**
     * @return list<DeviceSession>
     */
    private function browsers(User $user, Request $request): array
    {
        if (! $this->hasSessionTable()) {
            return [];
        }

        $currentId = $this->currentToken($user) !== null || ! $request->hasSession() ? null : $request->session()->getId();
        $since = now()->subMinutes(config()->integer('session.lifetime'))->getTimestamp();

        $rows = [];

        foreach ($this->sessionTable()->where('user_id', $user->getKey())->where('last_activity', '>=', $since)->orderByDesc('last_activity')->get(['id', 'user_agent', 'last_activity']) as $row) {
            $agent = is_string($row->user_agent ?? null) ? $row->user_agent : '';

            $rows[] = new DeviceSession(
                $this->browserId((string) $row->id),
                SessionKind::Web,
                self::browserName($agent),
                'web',
                null,
                CarbonImmutable::createFromTimestamp((int) $row->last_activity),
                $currentId !== null && hash_equals((string) $row->id, $currentId),
            );
        }

        return $rows;
    }

    /**
     * "Chrome auf macOS": enough to recognise a browser, nothing more (no versions).
     */
    public static function browserName(string $agent): string
    {
        $browser = match (true) {
            str_contains($agent, 'Edg/') => 'Edge',
            str_contains($agent, 'OPR/') => 'Opera',
            str_contains($agent, 'Firefox/') || str_contains($agent, 'FxiOS/') => 'Firefox',
            str_contains($agent, 'Chrome/') || str_contains($agent, 'CriOS/') => 'Chrome',
            str_contains($agent, 'Safari/') => 'Safari',
            default => null,
        };
        $os = match (true) {
            str_contains($agent, 'iPhone') || str_contains($agent, 'iPad') => 'iOS',
            str_contains($agent, 'Android') => 'Android',
            str_contains($agent, 'Mac OS X') || str_contains($agent, 'Macintosh') => 'macOS',
            str_contains($agent, 'Windows') => 'Windows',
            str_contains($agent, 'Linux') => 'Linux',
            default => null,
        };

        if ($browser === null) {
            return (string) __('settings.sessions.browser');
        }

        return $os === null ? $browser : (string) __('settings.sessions.browser_on', ['browser' => $browser, 'os' => $os]);
    }

    private function deviceKey(PersonalAccessToken $token): string
    {
        $device = $token->deviceId();

        return $device !== null ? 'id:'.$device : 'name:'.$token->deviceName().'|'.$token->getRawOriginal('platform');
    }

    private function browserId(string $sessionId): string
    {
        return 'w'.substr(hash_hmac('sha256', 'session|'.$sessionId, config()->string('app.key')), 0, 32);
    }

    /**
     * @return list<string>
     */
    private function sessionIds(User $user): array
    {
        if (! $this->hasSessionTable()) {
            return [];
        }

        /** @var list<string> */
        return $this->sessionTable()->where('user_id', $user->getKey())->pluck('id')->map(fn ($id): string => (string) $id)->all();
    }

    private function hasSessionTable(): bool
    {
        return config('session.driver') === 'database';
    }

    /**
     * @return Builder
     */
    private function sessionTable()
    {
        $connection = config('session.connection');

        /** @var ConnectionInterface $db */
        $db = DB::connection(is_string($connection) ? $connection : null);

        return $db->table(config()->string('session.table'));
    }
}
