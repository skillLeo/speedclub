<?php

namespace App\Http\Requests\Api\V1\Businesses;

use Illuminate\Foundation\Http\FormRequest;

/**
 * BIZ-02 Bewerbung: the application; `accept_terms` confirms the Impressum data is the applicant's own business and correct.
 */
class StoreBusinessRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            ...BusinessDetailsRules::rules(true),
            /** "Ich vertrete diesen Betrieb und die Angaben stimmen"; must be true. */
            'accept_terms' => ['required', 'accepted'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function details(): array
    {
        $data = $this->validated();
        unset($data['accept_terms']);

        return $data;
    }
}
