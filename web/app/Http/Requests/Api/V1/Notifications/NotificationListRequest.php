<?php

namespace App\Http\Requests\Api\V1\Notifications;

use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * HOME-02: newest first, cursor pages.
 */
class NotificationListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.config()->integer('speedclub.notifications.max_page_size')],
            'cursor' => ['nullable', 'string', 'max:1000', new ValidCursor(['created_at', 'id'])],
            /** M4.8 HOME-02 chips: only rows of this category; absent for all. */
            'category' => ['sometimes', Rule::in(['builds', 'social', 'events', 'system'])],
        ];
    }

    public function pageSize(): int
    {
        return $this->filled('per_page') ? $this->integer('per_page') : config()->integer('speedclub.notifications.page_size');
    }
}
