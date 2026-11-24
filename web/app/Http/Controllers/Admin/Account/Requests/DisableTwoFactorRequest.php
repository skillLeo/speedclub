<?php

namespace App\Http\Controllers\Admin\Account\Requests;

use App\Models\Staff;
use App\Services\Governance\Governance;
use Illuminate\Foundation\Http\FormRequest;

/** ADM-51 "2FA ausschalten" (ADR-540): the own account, only while 2FA für Admin-Konten is Optional and TOTP is on; no fields. */
class DisableTwoFactorRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->hasEnabledTwoFactorAuthentication() && ! Governance::staffTwoFactorRequired();
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
