<?php

namespace App\Http\Controllers\Admin\Content\Requests;

/** ADM-31 "Entwurf speichern" (`content.edit`): version, Markdown, re-consent and its summary (SaveLegalDraft validates them). */
class LegalDraftRequest extends ContentRequest
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
            'version' => ['required', 'string', 'max:32'],
            'body_md' => ['required', 'string', 'max:200000'],
            'requires_reconsent' => ['sometimes', 'boolean'],
            'summary' => ['nullable', 'string', 'max:1000'],
            'revision' => ['nullable', 'string', 'max:64'],
        ];
    }

    /** The revision of the draft the editor loaded ('' when it started without one), null from a caller that sends none. */
    public function revision(): ?string
    {
        return $this->has('revision') ? (string) $this->input('revision', '') : null;
    }

    /**
     * @return array<string, mixed>
     */
    public function draft(): array
    {
        return [
            'version' => $this->string('version')->trim()->value(),
            'body_md' => $this->string('body_md')->value(),
            'requires_reconsent' => $this->boolean('requires_reconsent'),
            'summary' => $this->filled('summary') ? $this->string('summary')->trim()->value() : null,
        ];
    }
}
