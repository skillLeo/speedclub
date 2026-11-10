<?php

namespace App\Http\Controllers\Admin\Support\Tickets\Requests;

use App\Enums\SupportTicketStatus;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** ADM-25/26 status and assignment (`support.reply`). */
class TicketUpdateRequest extends FormRequest
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
            'status' => ['sometimes', Rule::enum(SupportTicketStatus::class)],
            'staff_id' => ['sometimes', 'nullable', 'integer'],
        ];
    }
}
