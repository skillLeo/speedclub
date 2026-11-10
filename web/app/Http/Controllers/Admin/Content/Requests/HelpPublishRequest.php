<?php

namespace App\Http\Controllers\Admin\Content\Requests;

/** ADM-32 publish / unpublish (`content.publish`, optional reason). */
class HelpPublishRequest extends ContentRequest
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
        return [
            'published' => ['required', 'boolean'],
            'reason' => ['nullable', 'string', 'min:10', 'max:1000'],
        ];
    }
}
