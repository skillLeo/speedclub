<?php

namespace App\Http\Requests\Api\V1\Social2;

use App\Models\BuildUpdate;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Any subset of the post's fields, plus the order of its photos and before/after pairs (both by media id of this update's photos).
 */
class UpdateBuildUpdatePostRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $update = $this->route('update');
        $ownPhoto = $update instanceof BuildUpdate
            ? Rule::exists('media', 'id')->where('mediable_type', $update->getMorphClass())->where('mediable_id', $update->getKey())->whereNull('deleted_at')
            : 'prohibited';
        $max = config()->integer('speedclub.social_2.update_max_photos');

        return [
            ...StoreBuildUpdatePostRequest::fields($update instanceof BuildUpdate ? $update->vehicle_id : '', sometimes: true),
            'photo_order' => ['sometimes', 'array', 'max:'.$max],
            'photo_order.*' => ['string', 'distinct', $ownPhoto],
            'photo_pairs' => ['sometimes', 'array', 'max:'.intdiv($max, 2)],
            'photo_pairs.*' => ['array', 'size:2'],
            'photo_pairs.*.*' => ['string', 'distinct', $ownPhoto],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'modification_ids.*.exists' => (string) __('social.updates.mod_not_own'),
            'photo_pairs.*.*.exists' => (string) __('social.updates.pair_not_own'),
            'photo_order.*.exists' => (string) __('social.updates.pair_not_own'),
        ];
    }
}
