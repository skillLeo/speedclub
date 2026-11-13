<?php

namespace App\Http\Controllers\Admin\Auth\Requests;

use App\Http\Middleware\EnsureStaffTwoFactor;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/** ADM-03 "Später einrichten": only while the deployment allows it, and only for an account without confirmed TOTP. */
class SkipTwoFactorRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return EnsureStaffTwoFactor::skippable()
            && $staff instanceof Staff
            && ! $staff->hasEnabledTwoFactorAuthentication();
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }
}
