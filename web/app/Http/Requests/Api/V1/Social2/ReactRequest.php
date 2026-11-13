<?php

namespace App\Http\Requests\Api\V1\Social2;

use App\Enums\ReactionType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ReactRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['reaction' => ['required', Rule::enum(ReactionType::class)]];
    }
}
