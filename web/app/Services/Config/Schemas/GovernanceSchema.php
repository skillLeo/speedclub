<?php

namespace App\Services\Config\Schemas;

use App\Enums\ConfigKey;
use App\Services\Governance\Governance;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * `governance` (M5.1 ADM-52, ADR-507, ADR-540, Owner only via ConfigKey):
 * - `owner_override: bool` (default true): an Owner may execute their own four-eyes request of a publishing action
 *   (OwnerOverride::ACTIONS) when no second eligible approver exists; with false such a request waits for a second person until it
 *   expires. OwnerOverride::enabled() reads a published payload without a boolean `owner_override: true` as off (SEC-P5-03).
 * - `four_eyes: bool` (default false, ADR-540): "Vier-Augen-Prinzip"; off runs every approval action at once (Governance::fourEyes()).
 * - `staff_two_factor: required|optional` (default optional, ADR-540): "2FA für Admin-Konten" (Governance::staffTwoFactorRequired()).
 * The two ADR-540 keys may be absent (a version published before them, a rollback to one): they then take their defaults, so no
 * migration is needed. Versioned like every config key (ADM-35 history, rollback).
 */
final class GovernanceSchema extends Schema
{
    private const FIELDS = ['owner_override', 'four_eyes', 'staff_two_factor'];

    public function key(): ConfigKey
    {
        return ConfigKey::Governance;
    }

    public function normalize(array $payload): array
    {
        $unknown = array_diff(array_map(strval(...), array_keys($payload)), self::FIELDS);

        if ($unknown !== []) {
            $this->refuse(['payload' => (string) __('content.governance.field')]);
        }

        $data = Validator::make($payload, [
            'owner_override' => ['required', 'boolean'],
            'four_eyes' => ['sometimes', 'boolean'],
            'staff_two_factor' => ['sometimes', 'string', Rule::in(Governance::TWO_FACTOR_MODES)],
        ])->validate();

        return [
            'owner_override' => (bool) $data['owner_override'],
            'four_eyes' => array_key_exists('four_eyes', $data) ? (bool) $data['four_eyes'] : Governance::DEFAULT_FOUR_EYES,
            'staff_two_factor' => is_string($data['staff_two_factor'] ?? null) ? $data['staff_two_factor'] : Governance::DEFAULT_TWO_FACTOR,
        ];
    }

    public function initial(): array
    {
        return ['owner_override' => true, 'four_eyes' => Governance::DEFAULT_FOUR_EYES, 'staff_two_factor' => Governance::DEFAULT_TWO_FACTOR];
    }
}
