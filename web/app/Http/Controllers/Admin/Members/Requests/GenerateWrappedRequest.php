<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Http\Controllers\Admin\Members\MemberWrappedPanel;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/**
 * ADM-10 Wrapped "Vorschau erzeugen" (m5.9e contract §2): the season (`YYYY-saison` or `YYYY-jahr`, years 2000–2999, Season). No reason:
 * it writes what the nightly run would write and audits it (GenerateWrappedForUser). `support.reply`.
 */
class GenerateWrappedRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can(MemberWrappedPanel::GENERATE_ATOM);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // Exactly the keys Season::tryFrom accepts (years 2000–2999).
            'season_key' => ['required', 'string', 'regex:/\A2[0-9]{3}-(saison|jahr)\z/'],
        ];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }

    public function seasonKey(): string
    {
        return $this->string('season_key')->value();
    }
}
