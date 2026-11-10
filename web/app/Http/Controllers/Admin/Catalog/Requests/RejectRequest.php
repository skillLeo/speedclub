<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

/**
 * ADM-14 Anfragen → Ablehnen (`catalog.manage`): the reason goes to the member in the app, which shows 500 characters (DQ-607), so
 * the reason is 10–500 characters instead of the audit-only 1000.
 */
class RejectRequest extends CatalogFormRequest
{
    public const REASON_MAX = 500;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['reason' => ['required', 'string', 'min:10', 'max:'.self::REASON_MAX]];
    }
}
