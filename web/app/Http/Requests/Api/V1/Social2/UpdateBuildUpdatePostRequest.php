<?php

namespace App\Http\Requests\Api\V1\Social2;

use App\Enums\BuildUpdateKind;
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
        $beforeAfter = $update instanceof BuildUpdate && $update->kind === BuildUpdateKind::BeforeAfter;
        // M5.9c: a before/after holds two photos and one pair.
        $max = $beforeAfter ? config()->integer('speedclub.build_score.before_after_photos') : config()->integer('speedclub.social_2.update_max_photos');

        return [
            ...StoreBuildUpdatePostRequest::fields($update instanceof BuildUpdate ? $update->vehicle_id : '', sometimes: true),
            ...($beforeAfter ? ['modification_ids' => ['sometimes', 'nullable', 'array', 'max:1']] : []),
            'photo_order' => ['sometimes', 'array', 'max:'.$max],
            'photo_order.*' => ['string', 'distinct', $ownPhoto],
            'photo_pairs' => ['sometimes', 'array', 'max:'.max(1, intdiv($max, 2))],
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
            ...($this->route('update') instanceof BuildUpdate && $this->route('update')->kind === BuildUpdateKind::BeforeAfter
                ? ['photo_pairs.max' => (string) __('build_score.before_after.one_pair'), 'modification_ids.max' => (string) __('build_score.before_after.one_mod')]
                : []),
        ];
    }
}
