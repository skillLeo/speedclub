<?php

namespace App\Http\Controllers\Admin\Settings\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Models\Staff;
use App\Services\Privacy\OrgIdentity;
use Illuminate\Http\Exceptions\HttpResponseException;

/**
 * ADM-52 "Speichern" (Owner only, `staff.manage`, recent password; ADR-540: no reason): the 17 fields of OrgSchema; the schema
 * normalises and validates each. Client round 6: a refusal never looks like nothing happened. A non-Owner's save from the page
 * (Inertia) goes back with the error in the dialog and as a toast, saying who can save; a JSON client gets the 403 as before.
 */
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

    protected function failedAuthorization(): void
    {
        if ($this->header('X-Inertia') !== null) {
            $message = (string) __('content.org.owner_only');

            throw new HttpResponseException(back(303)->withErrors(['values' => $message])->with('error', $message));
        }

        parent::failedAuthorization();
    }

    /**
     * @return array<string, string>
     */
    public function attributes(): array
    {
        $names = [];

        foreach (OrgIdentity::FIELDS as $field) {
            $names["values.$field"] = (string) __("content.org.fields.$field");
        }

        return $names;
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
