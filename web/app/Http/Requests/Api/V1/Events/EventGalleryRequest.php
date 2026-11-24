<?php

namespace App\Http\Requests\Api\V1\Events;

use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * M5.6 GET events/{slug}/gallery (m5.6-contract §4.4). The approved list is ordered by approval (sort, id), the organiser's queue and
 * the member's own uploads by upload time (created_at, id), both oldest first; a cursor of the other order is refused with 422.
 */
class EventGalleryRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** approved (default, everybody) · pending (the organiser's queue) · mine (the reader's own uploads, every status). */
            'status' => ['sometimes', Rule::in(['approved', 'pending', 'mine'])],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.config()->integer('speedclub.events.gallery_page_max')],
            /** The `next_cursor` of the previous page of the same list. */
            'cursor' => ['sometimes', 'string', 'max:512', new ValidCursor($this->cursorColumns())],
        ];
    }

    public function status(): string
    {
        $status = $this->validated('status');

        return is_string($status) ? $status : 'approved';
    }

    /**
     * @return list<string>
     */
    public function cursorColumns(): array
    {
        return $this->input('status', 'approved') === 'approved'
            ? ['event_photos.sort', 'event_photos.id']
            : ['event_photos.created_at', 'event_photos.id'];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? config()->integer('speedclub.events.gallery_page_size'));
    }
}
