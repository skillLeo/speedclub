<?php

namespace App\Services\Config\Schemas;

use App\Enums\ConfigKey;
use App\Services\Rules\RateLimitOverrides;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * `rate_limits` (M3.4 ADM-23, m3.4 contract): {overrides: {limiter name: max}} within RateLimitOverrides::bounds() of the default. After
 * the publish commits, the overrides are written to the cache App\Http\RateLimits reads at boot.
 */
final class RateLimitsSchema extends Schema
{
    public function key(): ConfigKey
    {
        return ConfigKey::RateLimits;
    }

    public function normalize(array $payload): array
    {
        $defaults = RateLimitOverrides::defaults();
        $rules = ['overrides' => ['present', 'array']];

        foreach ($defaults as $name => $limit) {
            $bounds = RateLimitOverrides::bounds($limit['max']);
            $rules["overrides.$name"] = ['nullable', 'integer', "between:{$bounds['min']},{$bounds['max']}"];
        }

        Validator::make($payload, $rules)->validate();
        /** @var array<array-key, int|null> $given */
        $given = $payload['overrides'];
        $unknown = array_diff(array_keys($given), array_keys($defaults));

        if ($unknown !== []) {
            $this->refuse(['overrides' => (string) __('content.rate_limits.unknown', ['names' => implode(', ', $unknown)])]);
        }

        $overrides = array_map(intval(...), array_filter($given, fn (mixed $value): bool => $value !== null));
        ksort($overrides);

        return ['overrides' => $overrides];
    }

    public function initial(): array
    {
        return ['overrides' => []];
    }

    public function published(array $payload): void
    {
        /** @var array<string, int> $overrides */
        $overrides = is_array($payload['overrides'] ?? null) ? $payload['overrides'] : [];
        DB::afterCommit(fn () => RateLimitOverrides::remember($overrides));
    }
}
