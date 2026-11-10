<?php

namespace App\Http\Controllers\Admin\Support\Tickets\Requests;

use App\Enums\SupportTicketStatus;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** ADM-26 reply or internal note (`support.reply`); the status after a reply (default: waiting for the member). */
class TicketReplyRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('support.reply');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'min:2', 'max:5000'],
            'status' => ['nullable', Rule::enum(SupportTicketStatus::class)],
        ];
    }
}
