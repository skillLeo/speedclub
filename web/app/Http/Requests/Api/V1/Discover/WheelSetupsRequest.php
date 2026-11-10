<?php

namespace App\Http\Requests\Api\V1\Discover;

/**
 * DISC-04 "Räder-Vergleich": like the model's builds, without a sort (always the newest change first).
 */
class WheelSetupsRequest extends ModelBuildsRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $rules = parent::rules();
        unset($rules['sort']);

        return $rules;
    }
}
