<?php

namespace App\Http\Controllers\Admin\Content\Requests;

/** ADM-32 create or edit (`content.edit`; a published article also needs content.publish, checked in SaveHelpArticle). */
class HelpArticleRequest extends ContentRequest
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
        return [
            'key' => ['required', 'string', 'max:64'],
            'locale' => ['required', 'string', 'max:5'],
            'category' => ['nullable', 'string', 'max:32'],
            'title' => ['required', 'string', 'max:160'],
            'body_md' => ['required', 'string', 'max:20000'],
            'sort' => ['nullable', 'integer', 'between:0,65535'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function article(): array
    {
        return [
            'key' => $this->string('key')->trim()->value(),
            'locale' => $this->string('locale')->value(),
            'category' => $this->filled('category') ? $this->string('category')->trim()->value() : null,
            'title' => $this->string('title')->value(),
            'body_md' => $this->string('body_md')->value(),
            'sort' => $this->filled('sort') ? $this->integer('sort') : null,
        ];
    }
}
