<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

use App\Enums\CatalogLevel;
use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/**
 * An ADM-14…17 write (m3.3-contract §2): one permission atom (also on the route and in the Action) and the reason, required where 06
 * says "with reason" (10–1000 characters, into the audit event), optional on create and edit. The Actions validate the catalogue
 * fields themselves (EntryRules, FieldRules, CategoryRules), so the rules here are the shape the page sends.
 */
abstract class CatalogFormRequest extends FormRequest
{
    protected function atom(): string
    {
        return 'catalog.manage';
    }

    protected function reasonRequired(): bool
    {
        return true;
    }

    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can($this->atom());
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'reason' => $this->reasonRequired() ? ['required', 'string', 'min:10', 'max:1000'] : ['nullable', 'string', 'max:1000'],
            ...$this->extraRules(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function extraRules(): array
    {
        return [];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }

    public function reason(): ?string
    {
        $reason = trim($this->string('reason')->value());

        return $reason === '' ? null : $reason;
    }

    public function level(): CatalogLevel
    {
        return CatalogLevel::from((string) $this->route('level'));
    }
}
