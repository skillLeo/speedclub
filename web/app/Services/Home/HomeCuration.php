<?php

namespace App\Services\Home;

use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Models\ConfigVersion;
use App\Models\Vehicle;
use App\Services\Config\PreviewTokens;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * The editorial source of HOME-01's featured slot and the Für dich boost (ADM-29, ADR-190): the featured entries of the published
 * `home_curation` version that are live now (inside their date range), in their order, as vehicle slugs. While none is live, the
 * fallback is speedclub.home.featured_slugs. A staff member's preview token with a home_curation draft shows that draft instead
 * (ADM-34). Visibility is the caller's part (HomeFeed and HomeRanking read only visible builds).
 */
final class HomeCuration
{
    private const CACHE_KEY = 'home:curation:v1';

    public function __construct(private readonly PreviewTokens $previews) {}

    /**
     * @return list<string>
     */
    public function featuredSlugs(?Carbon $at = null): array
    {
        $at ??= now();
        $preview = $this->previews->current()?->payload(ConfigKey::HomeCuration);
        $entries = $preview !== null ? $this->entries($preview) : $this->published();
        $live = array_values(array_filter($entries, fn (array $entry): bool => ($entry['starts_at'] === null || Carbon::parse($entry['starts_at'])->lessThanOrEqualTo($at))
            && ($entry['ends_at'] === null || Carbon::parse($entry['ends_at'])->greaterThan($at))));

        if ($live === []) {
            /** @var list<string> */
            return array_values(array_filter(config()->array('speedclub.home.featured_slugs'), is_string(...)));
        }

        $ids = array_column($live, 'vehicle_id');
        $slugs = Vehicle::query()->whereKey($ids)->pluck('slug', 'id')->all();

        return array_values(array_filter(array_map(fn (string $id): ?string => isset($slugs[$id]) ? (string) $slugs[$id] : null, $ids)));
    }

    public function forget(): void
    {
        Cache::forget(self::CACHE_KEY);
    }

    /**
     * @return list<array{vehicle_id: string, starts_at: string|null, ends_at: string|null}>
     */
    private function published(): array
    {
        try {
            /** @var list<array{vehicle_id: string, starts_at: string|null, ends_at: string|null}> */
            return Cache::remember(self::CACHE_KEY, 300, function (): array {
                $payload = ConfigVersion::query()->where('key', ConfigKey::HomeCuration->value)->where('status', ConfigVersionStatus::Published)
                    ->orderByDesc('version')->value('payload');

                if (is_string($payload)) {
                    $payload = json_decode($payload, true);
                }

                return is_array($payload) ? $this->entries($payload) : [];
            });
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * @param  array<array-key, mixed>  $payload
     * @return list<array{vehicle_id: string, starts_at: string|null, ends_at: string|null}>
     */
    private function entries(array $payload): array
    {
        $entries = [];

        foreach (is_array($payload['featured'] ?? null) ? $payload['featured'] : [] as $entry) {
            if (is_array($entry) && is_string($entry['vehicle_id'] ?? null)) {
                try {
                    $entries[] = [
                        'vehicle_id' => $entry['vehicle_id'],
                        'starts_at' => is_string($entry['starts_at'] ?? null) ? Carbon::parse($entry['starts_at'])->toIso8601ZuluString() : null,
                        'ends_at' => is_string($entry['ends_at'] ?? null) ? Carbon::parse($entry['ends_at'])->toIso8601ZuluString() : null,
                    ];
                } catch (Throwable) {
                    continue;
                }
            }
        }

        return $entries;
    }
}
