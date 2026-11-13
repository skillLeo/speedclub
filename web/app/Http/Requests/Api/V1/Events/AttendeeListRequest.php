<?php

namespace App\Http\Requests\Api\V1\Events;

use App\Enums\RsvpStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AttendeeListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The organiser filters by answer; everybody else always gets going members. */
            'status' => ['sometimes', Rule::enum(RsvpStatus::class)],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:50'],
            'cursor' => ['sometimes', 'string', 'max:512'],
        ];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? 30);
    }
}
