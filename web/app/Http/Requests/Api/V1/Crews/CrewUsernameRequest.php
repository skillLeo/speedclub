<?php

namespace App\Http\Requests\Api\V1\Crews;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A member named by username: an invitation (POST crews/{slug}/invites) or the new founder (POST crews/{slug}/founder).
 */
class CrewUsernameRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['username' => ['required', 'string', 'max:41']];
    }

    public function username(): string
    {
        return ltrim((string) $this->validated('username'), '@');
    }
}
