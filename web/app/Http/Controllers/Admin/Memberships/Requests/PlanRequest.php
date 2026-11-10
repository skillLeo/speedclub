<?php

namespace App\Http\Controllers\Admin\Memberships\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/** ADM-F1 plan (`memberships.manage`): key (new plans only), name DE/EN, features DE/EN (one per line), active. SavePlan validates. */
class PlanRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('memberships.manage');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'key' => ['nullable', 'string', 'max:64'],
            'name' => ['required', 'array'],
            'features' => ['present', 'array'],
            'active' => ['required', 'boolean'],
        ];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }
}
