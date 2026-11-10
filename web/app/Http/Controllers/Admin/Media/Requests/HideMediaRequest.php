<?php

namespace App\Http\Controllers\Admin\Media\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Moderation\Statement;

/** ADM-13 "Ausblenden" (recent password): the statement of reasons the owner reads, and a reason. */
class HideMediaRequest extends ReasonRequest
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
        return Statement::rules();
    }
}
