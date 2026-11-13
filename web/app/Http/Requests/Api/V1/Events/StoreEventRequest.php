<?php

namespace App\Http\Requests\Api\V1\Events;

use Illuminate\Foundation\Http\FormRequest;

class StoreEventRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            ...EventDetailsRules::rules(true),
            /** The organiser accepts the rules for meets (09 §8.7 creation rights); must be true. */
            'accept_rules' => ['required', 'accepted'],
            /** Send it on at once (pre-moderation or published); false keeps a draft. Default false. */
            'submit' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return ['accept_rules.accepted' => (string) __('events.rules_required'), 'accept_rules.required' => (string) __('events.rules_required')];
    }

    /**
     * @return array<string, mixed>
     */
    public function details(): array
    {
        $data = $this->validated();
        unset($data['accept_rules'], $data['submit']);

        return EventDetailsRules::normalise($data);
    }
}
