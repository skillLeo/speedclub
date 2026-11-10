<?php

namespace App\Services\AppConfig;

use App\Models\FeatureFlag;
use App\Models\User;

/**
 * Server-side check of a public flag, with the rule AppConfig uses for clients: on, and not a partial rollout. One query per
 * request, so a list of modifications does not ask once per row.
 */
class FeatureFlags
{
    private const REQUEST_ATTRIBUTE = 'speedclub.flags';

    public function enabled(string $key): bool
    {
        $attributes = request()->attributes;

        /** @var array<string, bool> $flags */
        $flags = $attributes->get(self::REQUEST_ATTRIBUTE, []);

        if (! array_key_exists($key, $flags)) {
            $flags[$key] = $this->read($key);
            $attributes->set(self::REQUEST_ATTRIBUTE, $flags);
        }

        return $flags[$key];
    }

    /**
     * A member flag for one member (ADM-36): on, not staff-only, and the member's stable bucket (0–99, from the flag key and the member
     * id, so the same member keeps the same answer while the percentage only grows) below the rollout percentage.
     */
    public function forMember(string $key, User $member): bool
    {
        $flag = FeatureFlag::query()->where('key', $key)->first();

        if ($flag === null || $flag->getAttribute('enabled') !== true) {
            return false;
        }

        /** @var array<string, mixed> $rules */
        $rules = $flag->getAttribute('rules') ?? [];
        $percentage = is_numeric($rules['percentage'] ?? null) ? (float) $rules['percentage'] : 100.0;

        return ($rules['staff_only'] ?? false) !== true && self::bucket($key, (string) $member->getKey()) < $percentage;
    }

    public static function bucket(string $key, string $memberId): int
    {
        return (int) (hexdec(substr(hash('sha256', $key.'|'.$memberId), 0, 8)) % 100);
    }

    private function read(string $key): bool
    {
        $flag = FeatureFlag::query()->where('key', $key)->first();

        if ($flag === null || $flag->getAttribute('enabled') !== true) {
            return false;
        }

        /** @var array<string, mixed> $rules */
        $rules = $flag->getAttribute('rules') ?? [];
        $percentage = $rules['percentage'] ?? 100;

        return ($rules['staff_only'] ?? false) !== true && is_numeric($percentage) && (float) $percentage >= 100;
    }
}
