<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Http\Controllers\Admin\Members\MemberListQuery;
use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Models\Staff;

/** ADM-09 "CSV mit E-Mail-Adressen" (SEC-P3-03): a PII export, four-eyes; needs members.export and members.view_pii, a reason. */
class ListExportRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'members.export';
    }

    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return parent::authorize() && $staff instanceof Staff && $staff->can('members.view_pii');
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [
            'filter' => ['sometimes', 'array:'.implode(',', MemberListQuery::FILTERS)],
            'filter.*' => ['nullable', 'string', 'max:200'],
            'sort' => ['nullable', 'string', 'max:40'],
        ];
    }
}
