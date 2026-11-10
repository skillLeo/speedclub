<?php

namespace App\Services\Config\Schemas;

use App\Enums\ConfigKey;
use App\Services\Privacy\RetentionPolicy;
use Illuminate\Support\Facades\Validator;

/**
 * `retention` (M3.6 ADM-47, `retention.manage`): {periods: {key: whole number}} for the keys of RetentionPolicy::EDITABLE, each within its
 * bounds; a key left out (or null) uses the default of config/speedclub.php. The prune commands read the published version
 * (RetentionPolicy::value()).
 */
final class RetentionSchema extends Schema
{
    public function key(): ConfigKey
    {
        return ConfigKey::Retention;
    }

    public function normalize(array $payload): array
    {
        $rules = ['periods' => ['present', 'array']];

        foreach (RetentionPolicy::EDITABLE as $key => $definition) {
            $rules["periods.$key"] = ['nullable', 'integer', "between:{$definition['min']},{$definition['max']}"];
        }

        Validator::make($payload, $rules)->validate();
        /** @var array<array-key, int|null> $given */
        $given = $payload['periods'];
        $unknown = array_diff(array_map(strval(...), array_keys($given)), array_keys(RetentionPolicy::EDITABLE));

        if ($unknown !== []) {
            $this->refuse(['periods' => (string) __('privacy.retention.unknown', ['keys' => implode(', ', $unknown)])]);
        }

        $periods = array_map(intval(...), array_filter($given, fn (mixed $value): bool => $value !== null));
        ksort($periods);

        return ['periods' => $periods];
    }

    public function initial(): array
    {
        return ['periods' => []];
    }
}
