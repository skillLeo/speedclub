<?php

namespace App\Http\Requests\Api\V1\Maintenance;

use Illuminate\Foundation\Http\FormRequest;

class UpcomingRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** Items due within this many days (overdue ones and those within 1,000 km always). Default 60. */
            'days' => ['sometimes', 'integer', 'min:1', 'max:400'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:50'],
        ];
    }
}
