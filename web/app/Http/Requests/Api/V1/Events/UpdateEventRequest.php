<?php

namespace App\Http\Requests\Api\V1\Events;

use Illuminate\Foundation\Http\FormRequest;

class UpdateEventRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return EventDetailsRules::rules(false);
    }

    /**
     * @return array<string, mixed>
     */
    public function details(): array
    {
        return EventDetailsRules::normalise($this->validated());
    }
}
