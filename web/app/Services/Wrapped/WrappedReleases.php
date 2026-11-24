<?php

namespace App\Services\Wrapped;

use App\Enums\ConfigKey;
use App\Models\Wrapped;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Config\ConfigVersions;
use App\Services\Config\PreviewTokens;
use Carbon\CarbonImmutable;
use Throwable;

/**
 * When each Wrapped season opens (m5.9e contract §1): `wrapped.releases` of the published remote config ({season_key: ISO 8601}),
 * over the defaults in config/speedclub.php `wrapped.releases`. A staff preview token (ADM-34) whose remote_config draft holds other
 * dates overlays them for that GET only, which is the staff preview of a release. A season without a date is not released.
 *
 * Outside production a sample member's Wrapped (the showcase account of the gift demo, contract §7) counts as released, so the staging
 * demo opens without staff publishing a real date; samples are never generated in production (WrappedGenerator).
 */
final class WrappedReleases
{
    public const FLAG = 'wrapped';

    public const COUNTDOWN_FLAG = 'wrapped.countdown';

    /** @var array<string, CarbonImmutable>|null */
    private ?array $releases = null;

    public function __construct(
        private readonly ConfigVersions $versions,
        private readonly PreviewTokens $previews,
        private readonly FeatureFlags $flags,
    ) {}

    /**
     * Every season with a valid release date, earliest first.
     *
     * @return array<string, CarbonImmutable>
     */
    public function all(): array
    {
        if ($this->releases !== null) {
            return $this->releases;
        }

        $configured = config('speedclub.wrapped.releases');
        $merged = [
            ...(is_array($configured) ? $configured : []),
            ...$this->fromRemote($this->versions->live(ConfigKey::RemoteConfig)?->payload),
            ...$this->fromRemote($this->previews->current()?->payload(ConfigKey::RemoteConfig)),
        ];
        $releases = [];

        foreach ($merged as $key => $value) {
            if (Season::tryFrom($key) === null || ! is_string($value) || $value === '') {
                continue;
            }

            try {
                $releases[(string) $key] = CarbonImmutable::parse($value);
            } catch (Throwable) {
                continue;
            }
        }

        asort($releases);

        return $this->releases = $releases;
    }

    public function releaseAt(string $seasonKey): ?CarbonImmutable
    {
        return $this->all()[$seasonKey] ?? null;
    }

    public function isReleased(string $seasonKey, ?CarbonImmutable $now = null): bool
    {
        $at = $this->releaseAt($seasonKey);

        return $at !== null && ($now ?? CarbonImmutable::now())->greaterThanOrEqualTo($at);
    }

    /** Whether the member may open this Wrapped now: its season is released, or it is the staging demo of a sample member. */
    public function opens(Wrapped $wrapped, ?CarbonImmutable $now = null): bool
    {
        return $this->isReleased($wrapped->season_key, $now) || ($wrapped->is_sample && ! app()->isProduction());
    }

    /**
     * The Home banner (flag `wrapped.countdown`): the soonest of these seasons that opens within `wrapped.countdown_days`.
     *
     * @param  list<string>  $seasonKeys  the member's generated seasons
     * @return array{season_key: string, release_at: CarbonImmutable}|null
     */
    public function countdown(array $seasonKeys, ?CarbonImmutable $now = null): ?array
    {
        if (! $this->flags->enabled(self::COUNTDOWN_FLAG)) {
            return null;
        }

        $now ??= CarbonImmutable::now();
        $until = $now->addDays(config()->integer('speedclub.wrapped.countdown_days'));

        foreach ($this->all() as $key => $at) {
            if (in_array($key, $seasonKeys, true) && $at->greaterThan($now) && $at->lessThanOrEqualTo($until)) {
                return ['season_key' => $key, 'release_at' => $at];
            }
        }

        return null;
    }

    /**
     * The seasons the nightly generation works on: released within the next `wrapped.generate_days_before` days, and (CR-P5G-06) a
     * season whose release has come while its first full pass for that release is not done yet, for up to as many days after the
     * release, so a late date or a slow pass still reaches every member.
     *
     * @return list<string>
     */
    public function due(?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now();
        $days = config()->integer('speedclub.wrapped.generate_days_before');
        $until = $now->addDays($days);
        $since = $now->subDays($days);

        return array_keys(array_filter($this->all(), fn (CarbonImmutable $at, string $key): bool => ($at->greaterThan($now) && $at->lessThanOrEqualTo($until))
            || ($at->lessThanOrEqualTo($now) && $at->greaterThan($since) && ! WrappedGenerator::passCompleted(Season::from($key), WrappedGenerator::runKey($at))), ARRAY_FILTER_USE_BOTH));
    }

    /** Forgets what this instance read (a test or a long command after staff published new dates). */
    public function flush(): void
    {
        $this->releases = null;
    }

    /**
     * @return array<array-key, mixed>
     */
    private function fromRemote(mixed $payload): array
    {
        if (! is_array($payload) || ! is_array($payload['wrapped'] ?? null) || ! is_array($payload['wrapped']['releases'] ?? null)) {
            return [];
        }

        return $payload['wrapped']['releases'];
    }
}
