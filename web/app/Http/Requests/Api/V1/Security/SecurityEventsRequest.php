<?php

namespace App\Http\Requests\Api\V1\Security;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GET me/security-events (SET-21): a page of the member's security activity, newest first.
 */
class SecurityEventsRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** Rows per page, 1 to 50 (default 20). */
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
            /** The `next_cursor` of the previous page. */
            'cursor' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function pageSize(): int
    {
        return $this->integer('per_page', 20);
    }
}
