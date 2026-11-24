<?php

namespace App\Http\Requests\Api\V1\Crews;

use App\Enums\Bundesland;
use App\Enums\CrewJoinMode;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST crews. Name length, characters, reserved words and uniqueness are checked after the spaces are collapsed (CrewFields).
 */
class StoreCrewRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** 3–40 characters: letters, digits, spaces and - _ . & ' ! ; unique regardless of case. */
            'name' => ['required', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:'.config()->integer('speedclub.crews.description_max')],
            'bundesland' => ['sometimes', 'nullable', Rule::enum(Bundesland::class)],
            'join_mode' => ['required', Rule::enum(CrewJoinMode::class)],
        ];
    }

    /**
     * @return array{name: string, description: string|null, bundesland: string|null, join_mode: string}
     */
    public function details(): array
    {
        $description = $this->validated('description');
        $bundesland = $this->validated('bundesland');

        return [
            'name' => (string) $this->validated('name'),
            'description' => is_string($description) ? $description : null,
            'bundesland' => is_string($bundesland) ? $bundesland : null,
            'join_mode' => (string) $this->validated('join_mode'),
        ];
    }
}
