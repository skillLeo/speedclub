<?php

namespace App\Http\Requests\Api\V1\Insights;

use App\Enums\ViewSource;
use App\Enums\ViewSubject;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * POST views (m5.7-contract §3.1): the app's view beacon, once per screen focus of VEH-01 or PROF-02 that is not the viewer's own.
 */
class RecordViewRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** What was opened. */
            'subject' => ['required', 'string', Rule::enum(ViewSubject::class)],
            /** The vehicle's id, for `subject: vehicle`. */
            'id' => ['exclude_unless:subject,vehicle', 'required', 'string', 'ulid'],
            /** The member's username, for `subject: profile`. */
            'username' => ['exclude_unless:subject,profile', 'required', 'string', 'max:40', 'regex:/\A[A-Za-z0-9._]+\z/'],
            /** app (native), web (member web), sticker_scan (opened from the scanner or a /c link), shared_link (a link with ?via=share). */
            'source' => ['required', 'string', Rule::enum(ViewSource::class)],
        ];
    }
}
