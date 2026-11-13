<?php

namespace App\Http\Requests\Api\V1\Businesses;

use Illuminate\Foundation\Http\FormRequest;

/**
 * BIZ-03 "Profil bearbeiten": only the keys sent change. Once verified, the identity and Impressum fields are locked (422).
 */
class UpdateBusinessRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return BusinessDetailsRules::rules(false);
    }

    /**
     * @return array<string, mixed>
     */
    public function details(): array
    {
        return $this->validated();
    }
}
