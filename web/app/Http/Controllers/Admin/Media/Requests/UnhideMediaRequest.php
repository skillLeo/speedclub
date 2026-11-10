<?php

namespace App\Http\Controllers\Admin\Media\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-13 "Einblenden" (recent password): what the owner reads (facts) and a reason. */
class UnhideMediaRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'media.hide';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return ['facts' => ['required', 'string', 'min:10', 'max:5000']];
    }
}
