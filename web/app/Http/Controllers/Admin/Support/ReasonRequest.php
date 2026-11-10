<?php

namespace App\Http\Controllers\Admin\Support;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/**
 * An admin write that needs one permission atom and a reason (m3.1-contract §0: 10–1000 characters, it goes into the audit event).
 * Subclasses name the atom and may add rules.
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
        return ['reason' => ['required', 'string', 'min:10', 'max:1000'], ...$this->extraRules()];
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
