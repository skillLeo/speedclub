<?php

namespace App\Http\Requests\Api\V1\Events;

use App\Enums\RsvpStatus;
use App\Models\Event;
use App\Models\User;
use App\Rules\ValidCursor;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AttendeeListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The organiser filters by answer; everybody else always gets going members. */
            'status' => ['sometimes', Rule::enum(RsvpStatus::class)],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:50'],
            /** The `next_cursor` of the previous page. Any other cursor (of another list, or forged) is refused with 422. */
            'cursor' => ['sometimes', 'string', 'max:512', new ValidCursor($this->organises() ? ['event_rsvps.status_at', 'event_rsvps.id'] : ['attendee.username'])],
        ];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? 30);
    }

    /**
     * SEC-P4-02 (with security review L1): the organiser pages by answer time, everybody else by username, so each gets a cursor check
     * of its own order and a member never pages with the organiser's cursor, which carries answer times.
     *
     * Whether the member organises the event of the route, as AttendeeController decides it (Event::isOrganisedBy); a slug that finds
     * nothing pages as a member (and the controller answers 404 anyway).
     */
    private function organises(): bool
    {
        $slug = $this->route('slug');
        $user = $this->user();

        return is_string($slug) && $user instanceof User
            && Event::query()->where('slug', mb_strtolower($slug))->value('organiser_id') === $user->id;
    }
}
