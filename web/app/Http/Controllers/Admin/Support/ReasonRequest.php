<?php

namespace App\Http\Controllers\Admin\Support;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/**
 * An admin write that needs one permission atom (m3.1-contract §0). ADR-540 (client decision 2026-11-23): staff no longer give an
 * internal reason; an optional one (≤ 1000 characters) still goes into the audit event, an absent one is recorded as null. Only a
 * reason the member reads (a rejection or suspension text, reasonRequired()) stays required, 10–1000 characters. A DSA statement of
 * reasons is its own field set (Statement::rules()) and stays required where the subclass adds it. Subclasses name the atom and may
 * add rules.
 */
abstract class ReasonRequest extends FormRequest
{
    /** The permission atom of the action. */
    abstract protected function atom(): string;

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
        return ['reason' => $this->reasonRequired() ? ['required', 'string', 'min:10', 'max:1000'] : ['nullable', 'string', 'max:1000'], ...$this->extraRules()];
    }

    /** ADR-540: true only where the member reads the reason (rejection, suspension, cancellation text). */
    protected function reasonRequired(): bool
    {
        return false;
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

    public function reason(): string
    {
        return trim($this->string('reason')->value());
    }
}
