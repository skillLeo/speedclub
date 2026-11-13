<?php

namespace App\Http\Requests\Api\V1\Events;

use App\Enums\RsvpStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class RsvpRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** going ("Zusagen"; the waitlist when full) or interested. */
            'status' => ['required', Rule::in([RsvpStatus::Going->value, RsvpStatus::Interested->value])],
        ];
    }

    public function status(): RsvpStatus
    {
        return RsvpStatus::from((string) $this->validated('status'));
    }
}
