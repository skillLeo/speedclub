<?php

namespace App\Http\Controllers\Admin\Content\Requests;

/** ADM-31/32 Markdown preview (`content.edit`): the text as SET-17/18 and the Blade pages render it; nothing is stored. */
class MarkdownPreviewRequest extends ContentRequest
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
        return ['body_md' => ['present', 'nullable', 'string', 'max:200000']];
    }
}
