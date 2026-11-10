<?php

namespace App\Http\Controllers\Admin\Settings\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Models\Staff;
use App\Services\Privacy\OrgIdentity;

/** ADM-52 "Speichern" (Owner only, `staff.manage`, with reason): the 17 fields of OrgSchema; the schema validates each. */
class OrgSettingsRequest extends ReasonRequest
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
        $rules = ['values' => ['required', 'array']];

        foreach (OrgIdentity::FIELDS as $field) {
            $rules["values.$field"] = ['nullable', 'string', 'max:200'];
        }

        return $rules;
    }

    /**
     * @return array<string, string|null>
     */
    public function values(): array
    {
        $values = [];

        foreach (OrgIdentity::FIELDS as $field) {
            $value = $this->input("values.$field");
            $values[$field] = is_string($value) ? $value : null;
        }

        return $values;
    }
}
