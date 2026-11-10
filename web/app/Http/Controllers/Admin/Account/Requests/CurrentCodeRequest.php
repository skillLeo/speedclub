<?php

namespace App\Http\Controllers\Admin\Account\Requests;

use App\Models\Staff;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;

/** ADM-51 code steps: the current six-digit code of the authenticator (of the new key when confirming a rotation). */
class CurrentCodeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user('staff') instanceof Staff;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['code' => ['required', 'string', 'regex:/\A\s*\d{3}\s?\d{3}\s*\z/']];
    }

    public function code(): string
    {
        return (string) preg_replace('/\s+/', '', $this->string('code')->value());
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }

    /**
     * A JSON client gets the no-store 422 of the other code answers.
     */
    protected function failedValidation(Validator $validator): void
    {
        throw new ValidationException($validator, response()->json([
            'message' => $validator->errors()->first(),
            'errors' => $validator->errors()->toArray(),
        ], 422, ['Cache-Control' => 'no-store, private', 'Pragma' => 'no-cache']));
    }
}
