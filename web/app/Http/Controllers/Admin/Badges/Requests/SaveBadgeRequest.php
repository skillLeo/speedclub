<?php

namespace App\Http\Controllers\Admin\Badges\Requests;

use App\Enums\BadgeCategory;
use App\Enums\BadgeTier;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * ADM-63 "Abzeichen speichern" (create or edit): content.edit. Bounds the texts (name ≤ 80, description ≤ 255, hint ≤ 160, DE and EN),
 * the tier, category and sort; SaveBadge then validates the rule (BadgeRules: whitelisted metric + operator + value), the key and a
 * hint for hidden badges. The key is set once, on create (3–64 of a-z 0-9 -; "new" and "preview" name pages of the manager).
 */
class SaveBadgeRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('content.edit');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $creating = $this->route('badge') === null;

        return [
            ...($creating ? ['key' => ['required', 'string', 'regex:/\A[a-z0-9][a-z0-9-]{2,63}\z/', Rule::notIn(['new', 'preview'])]] : []),
            'name_de' => ['required', 'string', 'max:80'],
            'name_en' => ['required', 'string', 'max:80'],
            'description_de' => ['required', 'string', 'max:255'],
            'description_en' => ['required', 'string', 'max:255'],
            'hint_de' => ['nullable', 'string', 'max:160', 'required_if_accepted:hidden'],
            'hint_en' => ['nullable', 'string', 'max:160', 'required_if_accepted:hidden'],
            'hidden' => ['required', 'boolean'],
            'tier' => ['required', Rule::enum(BadgeTier::class)],
            'category' => ['required', Rule::enum(BadgeCategory::class)],
            'sort' => ['required', 'integer', 'min:0', 'max:9999'],
            ...($creating ? ['active' => ['required', 'boolean']] : []),
            'rule_json' => ['required', 'array'],
        ];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }

    /**
     * The validated input for SaveBadge (texts trimmed; the activity of an existing badge changes only through SetBadgeActive).
     *
     * @return array<string, mixed>
     */
    public function badgeInput(): array
    {
        $data = $this->validated();

        return [
            ...$data,
            'hidden' => (bool) $data['hidden'],
            ...(array_key_exists('active', $data) ? ['active' => (bool) $data['active']] : []),
            'sort' => (int) $data['sort'],
        ];
    }
}
