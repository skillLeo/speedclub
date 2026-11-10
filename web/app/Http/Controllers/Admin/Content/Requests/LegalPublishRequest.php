<?php

namespace App\Http\Controllers\Admin\Content\Requests;

/** ADM-31 "Veröffentlichen" ⚿ (`legal.publish`, reason); a terms or privacy draft with re-consent becomes a four-eyes request. */
class LegalPublishRequest extends ContentRequest
{
    protected function atom(): string
    {
        return 'legal.publish';
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['reason' => ['required', 'string', 'min:10', 'max:1000'], 'revision' => ['required', 'string', 'max:64']];
    }

    /** The revision of the draft the publisher saw (code review SF-1); mandatory, on the direct and the four-eyes path (SF-4). */
    public function revision(): string
    {
        return (string) $this->validated('revision');
    }
}
