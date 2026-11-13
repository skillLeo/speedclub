<?php

namespace App\Http\Requests\Api\V1\Businesses;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * BIZ-04 "Annehmen" / "Ablehnen" (and the member's confirmation of a business's proposal).
 */
class DecideTagRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['decision' => ['required', Rule::in(['accepted', 'declined'])]];
    }

    public function isAccepted(): bool
    {
        return $this->validated('decision') === 'accepted';
    }
}
