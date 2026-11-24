<?php

namespace App\Http\Requests\Api\V1\Crews;

use Illuminate\Foundation\Http\FormRequest;

/**
 * DELETE crews/{slug}: the founder types the crew's name to confirm.
 */
class DeleteCrewRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['confirm_name' => ['required', 'string', 'max:120']];
    }

    public function confirmName(): string
    {
        return (string) $this->validated('confirm_name');
    }
}
