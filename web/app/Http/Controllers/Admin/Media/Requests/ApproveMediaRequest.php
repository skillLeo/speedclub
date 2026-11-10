<?php

namespace App\Http\Controllers\Admin\Media\Requests;

use App\Http\Controllers\Admin\Support\ReasonRequest;

/** ADM-13 "Freigeben" (keyboard A): the reason is optional, the queue is worked one key at a time (ApproveMedia). */
class ApproveMediaRequest extends ReasonRequest
{
    protected function atom(): string
    {
        return 'media.review';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['reason' => ['nullable', 'string', 'max:1000']];
    }
}
