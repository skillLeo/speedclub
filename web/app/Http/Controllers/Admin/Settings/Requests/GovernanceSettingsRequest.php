<?php

namespace App\Http\Controllers\Admin\Settings\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Models\Staff;
use App\Services\Governance\Governance;
use Illuminate\Validation\Rule;

/**
 * ADM-52 Governance "Speichern" ⚿ (M5.1, ADR-507, ADR-540): Owner only (`staff.manage`), recent password; the Owner-Override switch,
 * "Vier-Augen-Prinzip" (`four_eyes`) and "2FA für Admin-Konten" (`staff_two_factor`: required|optional). The last two may be left out
 * (an older page): they then keep their live value. No reason (ADR-540).
 */
class GovernanceSettingsRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'staff.manage';
    }

    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return parent::authorize() && $staff instanceof Staff && $staff->isOwner();
    }

    protected function extraRules(): array
    {
        return [
            'owner_override' => ['required', 'boolean'],
            'four_eyes' => ['sometimes', 'boolean'],
            'staff_two_factor' => ['sometimes', 'string', Rule::in(Governance::TWO_FACTOR_MODES)],
        ];
    }

    public function fourEyes(): ?bool
    {
        return $this->has('four_eyes') ? $this->boolean('four_eyes') : null;
    }

    public function staffTwoFactor(): ?string
    {
        return $this->has('staff_two_factor') ? $this->string('staff_two_factor')->value() : null;
    }

    public function ownerOverride(): bool
    {
        return $this->boolean('owner_override');
    }
}
