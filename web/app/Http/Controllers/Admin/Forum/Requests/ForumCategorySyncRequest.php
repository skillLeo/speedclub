<?php

namespace App\Http\Controllers\Admin\Forum\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM Forum › Kategorien "Marken abgleichen" (moderation.rules): an optional reason. */
class ForumCategorySyncRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'moderation.rules';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['reason' => ['nullable', 'string', 'max:1000']];
    }
}
