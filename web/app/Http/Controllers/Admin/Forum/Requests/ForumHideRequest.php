<?php

namespace App\Http\Controllers\Admin\Forum\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;
use App\Services\Moderation\Statement;

/** ADM Forum "Ausblenden" (recent password): the statement of reasons the author reads (Art. 17 DSA), and a reason. */
class ForumHideRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.decide';
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return Statement::rules();
    }
}
