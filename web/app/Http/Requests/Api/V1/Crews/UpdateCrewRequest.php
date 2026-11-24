<?php

namespace App\Http\Requests\Api\V1\Crews;

use App\Enums\Bundesland;
use App\Enums\CrewJoinMode;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * PATCH crews/{slug}: only the keys sent change; `description` and `bundesland` null clear them.
 */
class UpdateCrewRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:'.config()->integer('speedclub.crews.description_max')],
            'bundesland' => ['sometimes', 'nullable', Rule::enum(Bundesland::class)],
            'join_mode' => ['sometimes', 'required', Rule::enum(CrewJoinMode::class)],
        ];
    }

    /**
     * @return array{name?: string, description?: string|null, bundesland?: string|null, join_mode?: string}
     */
    public function details(): array
    {
        $validated = $this->validated();
        $details = [];

        if (array_key_exists('name', $validated)) {
            $details['name'] = (string) $validated['name'];
        }

        foreach (['description', 'bundesland'] as $key) {
            if (array_key_exists($key, $validated)) {
                $details[$key] = is_string($validated[$key]) ? $validated[$key] : null;
            }
        }

        if (array_key_exists('join_mode', $validated)) {
            $details['join_mode'] = (string) $validated['join_mode'];
        }

        return $details;
    }
}
