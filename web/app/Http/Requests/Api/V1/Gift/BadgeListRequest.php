<?php

namespace App\Http\Requests\Api\V1\Gift;

use Illuminate\Foundation\Http\FormRequest;

class BadgeListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // 1: only badges earned since the unlock toast last showed (POST me/badges/seen), newest first. `0`/`1` as the contract says
            // (`?unseen=1`); a typed client would send a boolean as "true", which the boolean rule refuses.
            'unseen' => ['nullable', 'in:0,1'],
        ];
    }

    public function unseen(): bool
    {
        return filter_var($this->validated('unseen'), FILTER_VALIDATE_BOOLEAN);
    }
}
