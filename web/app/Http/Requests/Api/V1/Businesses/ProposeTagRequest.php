<?php

namespace App\Http\Requests\Api\V1\Businesses;

use Illuminate\Foundation\Http\FormRequest;

/**
 * BIZ-03 Portfolio "Build markieren": the mod the business built (on a public build); its owner confirms.
 */
class ProposeTagRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['mod_id' => ['required', 'string', 'size:26']];
    }
}
