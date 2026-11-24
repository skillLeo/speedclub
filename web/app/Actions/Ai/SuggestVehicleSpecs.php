<?php

namespace App\Actions\Ai;

use App\Enums\AiFeature;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Requests\Api\V1\Garage\UpdateSpecsRequest;
use App\Models\AiSpecSuggestion;
use App\Models\Generation;
use App\Models\User;
use App\Models\VehicleModel;
use App\Services\Ai\Agents\SpecSuggestionAgent;
use App\Services\Ai\AiFailed;
use App\Services\Ai\AiGateway;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * POST ai/specs/suggest (ai.vehicle_specs, opt-in; 10 §8.1 "Daten übernehmen?", m5.9-contract §2.1): typical factory engine variants for
 * a catalogue generation (or a model and year without generations). The prompt holds catalogue names only, never anything of the member,
 * and the answer is cached for every member who picks the same entry (`speedclub.ai.spec_cache_days`): a hit costs no provider call and
 * no part of the member's daily share. Each field must pass the spec form's own rules (UpdateSpecsRequest); a variant without one valid
 * field is dropped, none left → 422 ai_unverifiable. Nothing is written to the vehicle: the member confirms in the form.
 *
 * @phpstan-type Variant array{key: string, label: string, fields: array<string, string|int|float>}
 *
 * @throws AiFailed|ApiException
 */
class SuggestVehicleSpecs
{
    /** The spec fields a suggestion may fill (UpdateSpecsRequest keys; the sources are set by the member's confirm). */
    public const FIELDS = ['engine_code', 'displacement_cc', 'fuel', 'aspiration', 'power_value', 'power_unit', 'torque_nm', 'drivetrain', 'gearbox'];

    public function __construct(private readonly AiGateway $gateway) {}

    /**
     * @param  array{generation_id?: int|null, model_id?: int|null, model_year?: int|null}  $input  validated
     * @return array{suggestion: AiSpecSuggestion, subject: string, cached: bool}
     */
    public function handle(User $member, array $input): array
    {
        $this->gateway->ensureMayUse(AiFeature::VehicleSpecs, $member);

        [$generation, $model, $year] = $this->subject($input);
        $subject = $this->subjectName($generation, $model, $year);
        $key = hash('sha256', $generation !== null ? 'g:'.$generation->id : 'm:'.$model?->id.':'.$year);

        $cached = AiSpecSuggestion::query()->where('cache_key', $key)->where('expires_at', '>', now())->first();

        if ($cached instanceof AiSpecSuggestion) {
            return ['suggestion' => $cached, 'subject' => $subject, 'cached' => true];
        }

        $answer = $this->gateway->ask(AiFeature::VehicleSpecs, new SpecSuggestionAgent, 'Car: '.$subject, member: $member);
        $variants = self::variants($answer->list('variants'));

        if ($variants === []) {
            $this->gateway->reject($answer);
        }

        AiSpecSuggestion::query()->where('cache_key', $key)->delete();
        $suggestion = AiSpecSuggestion::query()->create([
            'generation_id' => $generation?->id,
            'model_id' => $generation === null ? $model?->id : null,
            'model_year' => $generation === null ? $year : null,
            'cache_key' => $key,
            'payload' => $variants,
            'ai_call_id' => $answer->callId,
            'created_at' => now(),
            'expires_at' => now()->addDays(config()->integer('speedclub.ai.spec_cache_days')),
        ]);

        return ['suggestion' => $suggestion, 'subject' => $subject, 'cached' => false];
    }

    /**
     * Keeps only fields the spec form accepts, as the form would store them; power needs value and unit together.
     *
     * @param  list<mixed>  $raw
     * @return list<Variant>
     */
    public static function variants(array $raw): array
    {
        $rules = array_intersect_key((new UpdateSpecsRequest)->rules(), array_flip(self::FIELDS));
        $variants = [];
        $keys = [];

        foreach (array_slice($raw, 0, 6) as $item) {
            if (! is_array($item)) {
                continue;
            }

            $fields = [];

            foreach (self::FIELDS as $field) {
                $value = $item[$field] ?? null;

                if ($value === null || $value === '' || Validator::make([$field => $value], [$field => $rules[$field]])->fails()) {
                    continue;
                }

                $fields[$field] = is_float($value) && floor($value) === $value ? (int) $value : $value;
            }

            if (! isset($fields['power_value'], $fields['power_unit'])) {
                unset($fields['power_value'], $fields['power_unit']);
            }

            $label = trim(is_string($item['label'] ?? null) ? $item['label'] : '');

            if ($fields === [] || $label === '') {
                continue;
            }

            $key = Str::limit(Str::slug($label), 40, '') ?: 'variant';
            $key = isset($keys[$key]) ? $key.'-'.(count($keys) + 1) : $key;
            $keys[$key] = true;
            $variants[] = ['key' => $key, 'label' => Str::limit($label, 60, ''), 'fields' => $fields];
        }

        return $variants;
    }

    /**
     * The variant's fields of a cached suggestion, or null when the suggestion or the variant is unknown or expired.
     *
     * @return array<string, string|int|float>|null
     */
    public static function variantFields(string $suggestionId, string $variant): ?array
    {
        $suggestion = AiSpecSuggestion::query()->whereKey($suggestionId)->where('expires_at', '>', now())->first();

        foreach ($suggestion->payload ?? [] as $item) {
            if ($item['key'] === $variant) {
                return $item['fields'];
            }
        }

        return null;
    }

    /**
     * @param  array{generation_id?: int|null, model_id?: int|null, model_year?: int|null}  $input
     * @return array{0: Generation|null, 1: VehicleModel|null, 2: int|null}
     */
    private function subject(array $input): array
    {
        if (isset($input['generation_id'])) {
            $generation = Generation::query()->with('vehicleModel.make')->where('active', true)->find($input['generation_id']);

            if ($generation instanceof Generation && $generation->vehicleModel?->getAttribute('active') === true) {
                return [$generation, $generation->vehicleModel, null];
            }
        } elseif (isset($input['model_id'], $input['model_year'])) {
            $model = VehicleModel::query()->with('make')->where('active', true)->find($input['model_id']);

            if ($model instanceof VehicleModel && ! Generation::query()->where('model_id', $model->id)->where('active', true)->exists()) {
                return [null, $model, (int) $input['model_year']];
            }
        }

        throw new ApiException(ErrorCode::ValidationFailed, errors: ['generation_id' => [(string) __('ai.unknown_vehicle')]]);
    }

    private function subjectName(?Generation $generation, ?VehicleModel $model, ?int $year): string
    {
        $model ??= $generation?->vehicleModel;
        $make = (string) $model?->make?->getAttribute('name');
        $name = trim($make.' '.(string) $model?->getAttribute('name'));

        if ($generation !== null) {
            $from = $generation->getAttribute('year_from');
            $to = $generation->getAttribute('year_to');
            $years = $from === null ? '' : ' ('.$from.'–'.($to ?? '').')';

            return trim($name.' '.$generation->getAttribute('name')).$years;
        }

        return $name.' ('.$year.')';
    }
}
