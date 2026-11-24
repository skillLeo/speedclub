<?php

namespace App\Services\Badges;

use App\Enums\BadgeMetric;
use App\Models\DexSet;
use Illuminate\Validation\ValidationException;

/**
 * The badge rule DSL (m5.9d contract §2): a small, declarative JSON object, validated here before it is stored and read again before it
 * is used. Never SQL, never code, never random.
 *
 *     {"metric": "<BadgeMetric>", "gte": <int 1–1000000>}      a counting metric reaches a value
 *     {"metric": "<boolean BadgeMetric>", "eq": true}         a yes/no metric holds
 *     {"metric": "set_completed", "set": "<dex set key>", "eq": true}
 *
 * Any other key, an unknown metric, a wrong operator for the metric or a value out of range is refused.
 */
final class BadgeRules
{
    public const MAX_VALUE = 1_000_000;

    /**
     * The rule in its stored form.
     *
     * @return array{metric: string, gte?: int, eq?: true, set?: string}
     *
     * @throws ValidationException on the field `rule_json`
     */
    public function validate(mixed $rule, string $field = 'rule_json'): array
    {
        $fail = fn (string $key): never => throw ValidationException::withMessages([$field => [(string) __('badges.rule.'.$key)]]);

        if (! is_array($rule) || array_is_list($rule)) {
            $fail('shape');
        }

        $metric = BadgeMetric::tryFrom(is_string($rule['metric'] ?? null) ? $rule['metric'] : '') ?? $fail('metric');
        $allowed = ['metric', $metric->isBoolean() ? 'eq' : 'gte', ...($metric->parameter() === null ? [] : [$metric->parameter()])];

        if (array_diff(array_keys($rule), $allowed) !== []) {
            $fail('keys');
        }

        $normal = ['metric' => $metric->value];

        if ($metric->isBoolean()) {
            if (($rule['eq'] ?? null) !== true) {
                $fail('eq');
            }

            $normal['eq'] = true;
        } else {
            $value = $rule['gte'] ?? null;

            if (! is_int($value) || $value < 1 || $value > self::MAX_VALUE) {
                $fail('gte');
            }

            $normal['gte'] = $value;
        }

        if ($metric->parameter() === 'set') {
            $set = $rule['set'] ?? null;

            if (! is_string($set) || ! DexSet::query()->whereKey($set)->exists()) {
                $fail('set');
            }

            $normal['set'] = $set;
        }

        return $normal;
    }

    /**
     * The stored rule, or null when it no longer validates (a set that was removed): such a badge is never awarded.
     *
     * @param  array<string, mixed>  $rule
     * @return array{metric: string, gte?: int, eq?: true, set?: string}|null
     */
    public function read(array $rule): ?array
    {
        try {
            return $this->validate($rule);
        } catch (ValidationException) {
            return null;
        }
    }

    /**
     * @param  array{metric: string, gte?: int, eq?: true, set?: string}  $rule
     */
    public function matches(array $rule, int $value): bool
    {
        return isset($rule['eq']) ? $value >= 1 : $value >= ($rule['gte'] ?? PHP_INT_MAX);
    }

    /**
     * The smallest metric value that matches (for SQL counting).
     *
     * @param  array{metric: string, gte?: int, eq?: true, set?: string}  $rule
     */
    public function threshold(array $rule): int
    {
        return isset($rule['eq']) ? 1 : ($rule['gte'] ?? PHP_INT_MAX);
    }
}
