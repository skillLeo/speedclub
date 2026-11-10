<?php

namespace App\Http\Controllers\Admin\Support\Tickets\Requests;

use App\Enums\SupportTicketStatus;
use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Admin\Members\BulkRunner;
use Illuminate\Validation\Rule;

/** ADM-25 bulk status (`support.reply`, reason): up to 500 tickets. */
class TicketBulkRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'support.reply';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'action' => ['required', Rule::in(['status'])],
            'status' => ['required', Rule::enum(SupportTicketStatus::class)],
            'ids' => ['required', 'array', 'min:1', 'max:'.BulkRunner::MAX_IDS],
            'ids.*' => ['string', 'size:26'],
        ];
    }
}
