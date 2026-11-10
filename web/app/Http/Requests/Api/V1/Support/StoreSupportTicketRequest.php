<?php

namespace App\Http\Requests\Api\V1\Support;

use App\Enums\SupportCategory;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreSupportTicketRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'category' => ['required', Rule::enum(SupportCategory::class)],
            'subject' => ['required', 'string', 'min:3', 'max:'.config()->integer('speedclub.support.subject_max_length')],
            'message' => ['required', 'string', 'min:10', 'max:'.config()->integer('speedclub.support.message_max_length')],
        ];
    }
}
