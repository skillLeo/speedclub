<?php

namespace App\Http\Requests\Api\V1\Businesses;

use Illuminate\Foundation\Http\FormRequest;

/**
 * GAR-10 / VEH-02 "Eingebaut von": the business (its slug) that installed the part.
 */
class ModTagRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['business' => ['required', 'string', 'regex:/\A[a-z0-9-]{2,140}\z/']];
    }
}
