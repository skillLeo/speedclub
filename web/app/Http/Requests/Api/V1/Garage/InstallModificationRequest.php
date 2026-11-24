<?php

namespace App\Http\Requests\Api\V1\Garage;

use Illuminate\Foundation\Http\FormRequest;

/**
 * M5.3 "Als verbaut markieren" (m5.3-contract §4.2). Both keys are optional: the month defaults to the current one in Germany.
 */
class InstallModificationRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** Month of installation as YYYY-MM, not in the future; the current month (Europe/Berlin) when left out. */
            'installed_on' => ['sometimes', 'nullable', 'date_format:Y-m'],
            /** What it cost in the end. Private, always: only the owner reads it (09 §11). Unchanged when left out. */
            'cost_cents' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:100000000'],
        ];
    }
}
