<?php

namespace App\Http\Requests\Api\V1\Crews;

use App\Enums\CrewRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH crews/{slug}/members/{username}: admin or member (the founder changes only by a hand-over).
 */
class CrewRoleRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['role' => ['required', Rule::in([CrewRole::Admin->value, CrewRole::Member->value])]];
    }

    public function role(): CrewRole
    {
        return CrewRole::from((string) $this->validated('role'));
    }
}
