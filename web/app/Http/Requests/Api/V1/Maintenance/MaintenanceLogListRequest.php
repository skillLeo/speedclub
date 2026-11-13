<?php

namespace App\Http\Requests\Api\V1\Maintenance;

use App\Http\Requests\Api\V1\Messaging\MessagingRules;
use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;

/**
 * MNT-01 "Verlauf": newest entry first, by item or year.
 */
class MaintenanceLogListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'item_id' => ['sometimes', 'string', MessagingRules::ULID],
            'year' => ['sometimes', 'integer', 'min:1950', 'max:2100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor(['done_at', 'id'])],
        ];
    }

    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : 30;
    }
}
