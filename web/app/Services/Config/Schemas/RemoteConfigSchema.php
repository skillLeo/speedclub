<?php

namespace App\Services\Config\Schemas;

use App\Enums\ConfigKey;
use Illuminate\Support\Facades\Validator;

/**
 * `remote_config` (ADM-37): {min_version, latest_version: {ios, android} as x.y.z with min ≤ latest, force_update_message: {de, en}|null,
 * maintenance: {enabled, message: {de, en}|null}}. Turning maintenance on is four-eyes (`maintenance.enable`, 06 §2); off is immediate.
 * Members have no bypass; a staff member's signed preview token is the bypass (App\Services\Config\PreviewTokens).
 */
final class RemoteConfigSchema extends Schema
{
    private const VERSION = 'regex:/\A(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\z/';

    public function key(): ConfigKey
    {
        return ConfigKey::RemoteConfig;
    }

    public function normalize(array $payload): array
    {
        $rules = [
            'maintenance' => ['required', 'array'],
            'maintenance.enabled' => ['required', 'boolean'],
            ...$this->localizedRules('maintenance.message', false, 300),
            ...$this->localizedRules('force_update_message', false, 300),
        ];

        foreach (['min_version', 'latest_version'] as $field) {
            $rules[$field] = ['required', 'array'];
            $rules["$field.ios"] = ['required', 'string', self::VERSION];
            $rules["$field.android"] = ['required', 'string', self::VERSION];
        }

        $data = Validator::make($payload, $rules)->validate();
        $errors = [];

        foreach (['ios', 'android'] as $platform) {
            if (version_compare((string) $data['min_version'][$platform], (string) $data['latest_version'][$platform], '>')) {
                $errors["min_version.$platform"] = (string) __('content.remote.min_above_latest');
            }
        }

        $enabled = (bool) $data['maintenance']['enabled'];
        $message = $this->localized($data['maintenance']['message'] ?? null);

        if ($enabled && $message === null) {
            $errors['maintenance.message.de'] = (string) __('content.remote.maintenance_message');
        }

        if ($errors !== []) {
            $this->refuse($errors);
        }

        return [
            'min_version' => ['ios' => (string) $data['min_version']['ios'], 'android' => (string) $data['min_version']['android']],
            'latest_version' => ['ios' => (string) $data['latest_version']['ios'], 'android' => (string) $data['latest_version']['android']],
            'force_update_message' => $this->localized($data['force_update_message'] ?? null),
            'maintenance' => ['enabled' => $enabled, 'message' => $message],
        ];
    }

    public function initial(): array
    {
        $defaults = config()->array('speedclub.app_config.remote_config');

        return [
            'min_version' => $defaults['min_version'],
            'latest_version' => $defaults['latest_version'],
            'force_update_message' => null,
            'maintenance' => ['enabled' => false, 'message' => null],
        ];
    }

    public function approvalFor(array $live, array $next): ?string
    {
        $was = is_array($live['maintenance'] ?? null) && ($live['maintenance']['enabled'] ?? false) === true;
        $will = is_array($next['maintenance'] ?? null) && ($next['maintenance']['enabled'] ?? false) === true;

        return ! $was && $will ? 'maintenance.enable' : null;
    }
}
