<?php

namespace App\Services\Ai;

use App\Actions\Ai\SuggestVehicleSpecs;
use App\Enums\AiFeature;
use App\Enums\ErrorCode;
use App\Enums\PowerSource;
use App\Exceptions\ApiException;
use App\Models\VehicleSpec;
use BackedEnum;

/**
 * M5.9 (m5.9-contract §2.1): which spec values of a vehicle came from "Daten übernehmen?" and still stand as taken over
 * (vehicle_specs.ai_fields, field => value). A PUT with `ai_suggestion` marks the fields equal to the chosen cached variant; any later
 * PUT keeps a mark only while the value is unchanged. Power and torque keep it only with the source "Herstellerangabe" (factory). The
 * mark shows as "Herstellerangabe (KI-Vorschlag)" on VEH-01/WEB-01 and as `ai_fields` to the owner.
 */
final class SpecProvenance
{
    public function __construct(private readonly AiGateway $gateway) {}

    /**
     * @param  array{cache_id?: string, variant?: string}|null  $suggestion  validated `ai_suggestion` of the PUT, if any
     * @return array<string, string|int|float>|null
     *
     * @throws ApiException 422 when the suggestion is unknown or expired
     */
    public function fields(VehicleSpec $specs, ?array $suggestion): ?array
    {
        $candidates = $specs->getOriginal('ai_fields');
        $candidates = is_array($candidates) ? $candidates : [];

        if ($suggestion !== null && $this->gateway->enabled(AiFeature::VehicleSpecs)) {
            $fields = SuggestVehicleSpecs::variantFields((string) ($suggestion['cache_id'] ?? ''), (string) ($suggestion['variant'] ?? ''));

            if ($fields === null) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['ai_suggestion' => [(string) __('ai.suggestion_expired')]]);
            }

            $candidates = $fields;
        }

        $kept = [];

        foreach ($candidates as $field => $value) {
            if (! in_array($field, SuggestVehicleSpecs::FIELDS, true) || ! self::same($this->current($specs, $field), $value)) {
                continue;
            }

            $kept[$field] = $value;
        }

        if (! isset($kept['power_value'], $kept['power_unit']) || $specs->power_source !== PowerSource::Factory) {
            unset($kept['power_value'], $kept['power_unit']);
        }

        if (isset($kept['torque_nm']) && $specs->getAttribute('torque_source') !== PowerSource::Factory) {
            unset($kept['torque_nm']);
        }

        return $kept === [] ? null : $kept;
    }

    /**
     * Whether $field of $specs still shows the suggestion's value.
     */
    public static function marked(VehicleSpec $specs, string $field): bool
    {
        $fields = $specs->getAttribute('ai_fields');

        return is_array($fields) && array_key_exists($field, $fields);
    }

    private function current(VehicleSpec $specs, string $field): mixed
    {
        $value = $specs->getAttribute($field);

        return $value instanceof BackedEnum ? $value->value : $value;
    }

    private static function same(mixed $current, mixed $value): bool
    {
        if (is_numeric($current) && is_numeric($value)) {
            return abs((float) $current - (float) $value) < 0.0001;
        }

        return is_string($current) && is_string($value) && mb_strtolower($current) === mb_strtolower($value);
    }
}
