<?php

namespace App\Http\Requests\Api\V1\Social2;

use App\Enums\BuildUpdateAudience;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * UPD-01 (09 §8.5). Photos follow with POST build-updates/{id}/media.
 */
class StoreBuildUpdatePostRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'vehicle_id' => ['required', 'string', 'size:26'],
            ...self::fields($this->string('vehicle_id')->lower()->toString()),
        ];
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
        return ['modification_ids.*.exists' => (string) __('social.updates.mod_not_own')];
    }
}
