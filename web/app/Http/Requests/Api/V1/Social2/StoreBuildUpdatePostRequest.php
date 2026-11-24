<?php

namespace App\Http\Requests\Api\V1\Social2;

use App\Enums\BuildUpdateAudience;
use App\Enums\BuildUpdateKind;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * UPD-01 (09 §8.5). Photos follow with POST build-updates/{id}/media. M5.9c: `kind=before_after` makes it a before/after pair: exactly
 * two photos follow (before, then after) and are paired by PATCH photo_pairs, or automatically when the second one arrives.
 */
class StoreBuildUpdatePostRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $vehicleId = $this->string('vehicle_id')->lower()->toString();
        $beforeAfter = $this->input('kind') === BuildUpdateKind::BeforeAfter->value;

        return [
            'vehicle_id' => ['required', 'string', 'size:26'],
            ...self::fields($vehicleId),
            // M5.9c (m5.9c contract §2): a before/after shows at most one mod, as modification_id or as the one entry of modification_ids.
            'kind' => ['sometimes', 'nullable', Rule::enum(BuildUpdateKind::class)],
            'modification_id' => ['sometimes', 'nullable', 'prohibited_unless:kind,'.BuildUpdateKind::BeforeAfter->value, 'string', Rule::exists('modifications', 'id')->where('vehicle_id', $vehicleId)->whereNull('deleted_at')],
            ...($beforeAfter ? ['modification_ids' => ['sometimes', 'nullable', 'array', 'max:1']] : []),
        ];
    }

    /**
     * The validated post with `kind` and the before/after's mod folded into modification_ids.
     *
     * @return array{text?: string|null, mileage_km?: int|null, happened_on?: string|null, audience?: string|null, modification_ids?: list<string>|null, kind: string}
     */
    public function postData(): array
    {
        /** @var array{text?: string|null, mileage_km?: int|null, happened_on?: string|null, audience?: string|null, modification_ids?: list<string>|null, kind?: string|null, modification_id?: string|null} $data */
        $data = $this->safe()->except('vehicle_id');
        $kind = BuildUpdateKind::tryFrom((string) ($data['kind'] ?? '')) ?? BuildUpdateKind::Post;
        $mod = $data['modification_id'] ?? null;
        unset($data['modification_id']);

        if ($kind === BuildUpdateKind::BeforeAfter && is_string($mod) && ($data['modification_ids'] ?? []) === []) {
            $data['modification_ids'] = [strtolower($mod)];
        }

        return [...$data, 'kind' => $kind->value];
    }

    /**
     * The fields a post and its edit share. Linked mods must be mods of $vehicleId that are not deleted.
     *
     * @return array<string, mixed>
     */
    public static function fields(string $vehicleId, bool $sometimes = false): array
    {
        $optional = $sometimes ? ['sometimes'] : [];

        return [
            'text' => [...$optional, 'nullable', 'string', 'max:'.config()->integer('speedclub.social_2.update_text_max')],
            'mileage_km' => [...$optional, 'nullable', 'integer', 'min:0', 'max:2000000'],
            'happened_on' => [...$optional, 'nullable', 'date_format:Y-m-d', 'after_or_equal:1950-01-01', 'before_or_equal:'.now()->addDay()->toDateString()],
            'audience' => [...$optional, 'nullable', Rule::enum(BuildUpdateAudience::class)],
            'modification_ids' => [...$optional, 'nullable', 'array', 'max:'.config()->integer('speedclub.social_2.update_max_mods')],
            'modification_ids.*' => ['string', 'distinct', Rule::exists('modifications', 'id')->where('vehicle_id', $vehicleId)->whereNull('deleted_at')],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'modification_ids.*.exists' => (string) __('social.updates.mod_not_own'),
            'modification_id.exists' => (string) __('social.updates.mod_not_own'),
            ...($this->input('kind') === BuildUpdateKind::BeforeAfter->value ? ['modification_ids.max' => (string) __('build_score.before_after.one_mod')] : []),
        ];
    }
}
