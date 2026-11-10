<?php

namespace App\Http\Requests\Api\V1\Me;

use App\Models\User;
use App\Rules\MemberPassword;
use Illuminate\Foundation\Http\FormRequest;

class ChangePasswordRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $user = $this->user();

        return [
            'current_password' => ['required', 'string', 'max:'.config()->integer('speedclub.passwords.max_length')],
            // 02_PRODUCT_SPEC §3.1: at least 10 characters, not common, not the address; not the username and not the current one.
            'password' => ['required', 'string', 'confirmed', new MemberPassword($user instanceof User ? $user->email : null)],
            'password_confirmation' => ['required', 'string'],
            // Also sign out the app on every other device. Other browsers end with any password change.
            'revoke_other_sessions' => ['sometimes', 'boolean:strict'],
            // With two-factor on: a current code from the authenticator app or a recovery code (SEC-P2-07).
            'code' => ['nullable', 'string', 'max:32'],
        ];
    }
}
