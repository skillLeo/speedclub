<?php

namespace App\Services\Privacy;

use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Models\ConfigVersion;

/**
 * ADM-47 retention (06_ADMIN_SPEC §4, m3.6 §1): the periods the prune commands apply, editable within bounds through the config key
 * `retention` (RetentionSchema, `retention.manage`, published with a reason and audited by the engine). The upper bound is the period the
 * privacy policy promises (a longer one needs a new policy first); the lower bound is what the law or a promise of the product needs
 * (an export stays downloadable 7 days after a deletion request, ADR-203 c; a GDPR request file is kept for the 3-year limitation period).
 * A value outside the bounds, or none, falls back to config/speedclub.php.
 *
 * FIXED lists the §4 periods that are not editable here (technical windows, legal-defence periods, host settings), for the page.
 */
final class RetentionPolicy
{
    /** @var array<string, int>|null */
    private ?array $live = null;

    /**
     * @var array<string, array{config: string, unit: 'hours'|'days'|'months', min: int, max: int}>
     */
    public const EDITABLE = [
        'accounts_hard_delete_days' => ['config' => 'speedclub.account_deletion.hard_delete_after_days', 'unit' => 'days', 'min' => 7, 'max' => 30],
        'deleted_vehicles_days' => ['config' => 'speedclub.garage.hard_delete_after_days', 'unit' => 'days', 'min' => 1, 'max' => 30],
        'deleted_media_days' => ['config' => 'speedclub.media.hard_delete_after_days', 'unit' => 'days', 'min' => 1, 'max' => 30],
        'unverified_accounts_days' => ['config' => 'speedclub.verification.unverified_account_retention_days', 'unit' => 'days', 'min' => 2, 'max' => 7],
        'known_devices_months' => ['config' => 'speedclub.known_devices.retention_months', 'unit' => 'months', 'min' => 1, 'max' => 12],
        'support_tickets_months' => ['config' => 'speedclub.support.retention_months', 'unit' => 'months', 'min' => 6, 'max' => 24],
        'audit_access_months' => ['config' => 'speedclub.audit.access_data_months', 'unit' => 'months', 'min' => 6, 'max' => 12],
        'privacy_requests_months' => ['config' => 'speedclub.privacy.retention_months', 'unit' => 'months', 'min' => 36, 'max' => 60],
    ];

    /**
     * @var array<string, array{value: int|null, unit: 'hours'|'days'|'months'|null}>
     */
    public const FIXED = [
        'verification_codes' => ['value' => 24, 'unit' => 'hours'],
        'idempotency_keys' => ['value' => 24, 'unit' => 'hours'],
        'sanctum_tokens' => ['value' => null, 'unit' => null],
        'messages_of_deleted_members' => ['value' => null, 'unit' => null],
        'audit_events' => ['value' => 24, 'unit' => 'months'],
        'audit_archive' => ['value' => 36, 'unit' => 'months'],
        'moderation_cases' => ['value' => 36, 'unit' => 'months'],
        'qr_scans' => ['value' => null, 'unit' => null],
        'application_logs' => ['value' => 14, 'unit' => 'days'],
        'backups' => ['value' => 30, 'unit' => 'days'],
    ];

    /** The value of a fixed period of FIXED (null: none, e.g. kept for the life of the account). */
    public function fixed(string $key): ?int
    {
        return (self::FIXED[$key] ?? throw new \InvalidArgumentException("Unknown retention key [$key]."))['value'];
    }

    /** The period in force for $key, within its bounds. */
    public function value(string $key): int
    {
        $definition = self::EDITABLE[$key] ?? throw new \InvalidArgumentException("Unknown retention key [$key].");
        $live = $this->live()[$key] ?? null;
        $value = is_int($live) ? $live : config()->integer($definition['config']);

        return max($definition['min'], min($definition['max'], $value));
    }

    /**
     * Every period for ADM-47: editable ones with default, bounds and value; fixed ones with their value.
     *
     * @return list<array{key: string, editable: bool, unit: string|null, value: int|null, default: int|null, min: int|null, max: int|null}>
     */
    public function catalogue(): array
    {
        $rows = [];

        foreach (self::EDITABLE as $key => $definition) {
            $rows[] = [
                'key' => $key,
                'editable' => true,
                'unit' => $definition['unit'],
                'value' => $this->value($key),
                'default' => config()->integer($definition['config']),
                'min' => $definition['min'],
                'max' => $definition['max'],
            ];
        }

        foreach (self::FIXED as $key => $definition) {
            $rows[] = ['key' => $key, 'editable' => false, 'unit' => $definition['unit'], 'value' => $definition['value'], 'default' => $definition['value'], 'min' => null, 'max' => null];
        }

        return $rows;
    }

    /**
     * The published periods, read once per instance (the prune commands and mails resolve a fresh one; no cache row, so nothing goes
     * stale between a publish and the next run).
     *
     * @return array<string, int>
     */
    private function live(): array
    {
        if ($this->live !== null) {
            return $this->live;
        }

        $row = ConfigVersion::query()->where('key', ConfigKey::Retention->value)->where('status', ConfigVersionStatus::Published)
            ->orderByDesc('version')->first();
        $periods = $row?->payload['periods'] ?? [];

        /** @var array<string, int> $live */
        $live = is_array($periods) ? array_filter($periods, is_int(...)) : [];

        return $this->live = $live;
    }
}
