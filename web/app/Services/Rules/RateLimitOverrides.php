<?php

namespace App\Services\Rules;

use App\Enums\ConfigVersionStatus;
use App\Http\RateLimits;
use App\Models\ConfigVersion;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Rate-limit overrides of ADM-23 (m3.4-contract §1): per limiter of config('speedclub.rate_limits'), a new `max` within 0.25× to 4× of the
 * default (at least 1), stored as the published config version `rate_limits` ({overrides: {name: max}}). App\Http\RateLimits reads them
 * at boot from the cache only (forever key, written on publish), so a request never queries the database for them; a cold cache is
 * filled once from the published version. Every value is bounded again when it is read, so a bad row cannot lift a limit.
 */
final class RateLimitOverrides
{
    public const CONFIG_KEY = 'rate_limits';

    public const CACHE_KEY = 'moderation:rate-limit-overrides:v1';

    public const MIN_FACTOR = 0.25;

    public const MAX_FACTOR = 4.0;

    /**
     * SEC-P3-20: limiters that guard sign-in, codes, account security and paid AI calls are never overridable from ADM-23 (a
     * Moderator holds moderation.rules); they stay as config/speedclub.php sets them. The staff limiters live elsewhere and never were.
     */
    public const PROTECTED = [
        'member_register', 'member_login', 'member_verify', 'member_email', 'two_factor_challenge', 'account_security', 'token_rotate',
        'web_account_deletion', 'ai', 'ai_translate',
    ];

    /**
     * The overrides read once per process (code review M3.4-batch MF-2): with the database cache store every Cache::get is a query, and
     * a lookup per limiter cost about 39 SELECTs on every request. RateLimits reads it at boot, so the one read happens before any request
     * work and every request of a process costs the same. remember() and flush() keep it current.
     *
     * @var array<string, int>|null
     */
    private static ?array $memo = null;

    /**
     * Limiter names that can be overridden: every limiter App\Http\RateLimits defines with a max, except PROTECTED (the staff limiters and
     * the CSRF cookie limit, defined elsewhere, stay as configured too). A stored override of a protected limiter is ignored when read.
     *
     * @return array<string, array{max: int, minutes: int}>
     */
    public static function defaults(): array
    {
        $defaults = [];

        $names = array_diff(RateLimits::names(), self::PROTECTED);

        foreach (config()->array('speedclub.rate_limits') as $name => $limit) {
            if (is_string($name) && in_array($name, $names, true) && is_array($limit) && is_int($limit['max'] ?? null) && is_int($limit['minutes'] ?? null)) {
                $defaults[$name] = ['max' => $limit['max'], 'minutes' => $limit['minutes']];
            }
        }

        ksort($defaults);

        return $defaults;
    }

    /**
     * @return array{min: int, max: int}
     */
    public static function bounds(int $default): array
    {
        return ['min' => max(1, (int) ceil($default * self::MIN_FACTOR)), 'max' => max(1, (int) floor($default * self::MAX_FACTOR))];
    }

    /**
     * The override in force for $name, bounded; null when there is none.
     */
    public static function maxFor(string $name, int $default): ?int
    {
        $value = self::current()[$name] ?? null;

        if (! is_int($value)) {
            return null;
        }

        $bounds = self::bounds($default);

        return max($bounds['min'], min($bounds['max'], $value));
    }

    /**
     * @return array<string, int>
     */
    public static function current(): array
    {
        if (self::$memo !== null) {
            return self::$memo;
        }

        return self::$memo = self::read();
    }

    /**
     * Forgets the per-process copy (tests, and after a publish in the same process).
     */
    public static function flush(): void
    {
        self::$memo = null;
    }

    /**
     * @return array<string, int>
     */
    private static function read(): array
    {
        try {
            $cached = Cache::get(self::CACHE_KEY);

            if (is_array($cached)) {
                return self::clean($cached);
            }

            $published = self::published();
            Cache::forever(self::CACHE_KEY, $published);

            return $published;
        } catch (Throwable) {
            // Boot before the database exists (composer install, a fresh checkout): the configured limits apply.
            return [];
        }
    }

    /**
     * @return array<string, int>
     */
    public static function published(): array
    {
        $version = ConfigVersion::query()->where('key', self::CONFIG_KEY)->where('status', ConfigVersionStatus::Published)->orderByDesc('version')->first();
        $overrides = $version?->payload['overrides'] ?? [];

        return is_array($overrides) ? self::clean($overrides) : [];
    }

    /**
     * Writes the published overrides to the cache, where the next boot reads them.
     *
     * @param  array<string, int>  $overrides
     */
    public static function remember(array $overrides): void
    {
        Cache::forever(self::CACHE_KEY, self::$memo = self::clean($overrides));
    }

    /**
     * @param  array<mixed>  $values
     * @return array<string, int>
     */
    private static function clean(array $values): array
    {
        $defaults = self::defaults();
        $clean = [];

        foreach ($values as $name => $value) {
            if (is_string($name) && isset($defaults[$name]) && is_int($value)) {
                $clean[$name] = $value;
            }
        }

        ksort($clean);

        return $clean;
    }
}
