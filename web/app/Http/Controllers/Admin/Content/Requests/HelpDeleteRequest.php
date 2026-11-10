<?php

namespace App\Http\Controllers\Admin\Content\Requests;

/** ADM-32 delete ⚿ (`content.publish`, reason). */
class HelpDeleteRequest extends ContentRequest
{
    protected function atom(): string
    {
        return 'content.publish';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['reason' => ['required', 'string', 'min:10', 'max:1000']];
    }
}
