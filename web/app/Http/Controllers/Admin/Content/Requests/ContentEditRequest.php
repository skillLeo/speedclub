<?php

namespace App\Http\Controllers\Admin\Content\Requests;

/** A `content.edit` write without fields of its own (discarding a legal draft). */
class ContentEditRequest extends ContentRequest
{
    protected function atom(): string
    {
        return 'content.edit';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [];
    }
}
