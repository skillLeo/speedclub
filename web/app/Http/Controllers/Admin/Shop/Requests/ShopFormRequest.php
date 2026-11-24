<?php

namespace App\Http\Controllers\Admin\Shop\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/**
 * An ADM-66/67 write (m5.5-contract §5): the atom shop.manage (also on the route) and an optional reason (≤ 1000 characters, into the
 * audit event).
 */
abstract class ShopFormRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('shop.manage');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['reason' => ['sometimes', 'nullable', 'string', 'max:1000'], ...$this->extraRules()];
    }

    /**
     * @return array<string, mixed>
     */
    abstract protected function extraRules(): array;

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

    /**
     * The validated fields without the reason.
     *
     * @return array<string, mixed>
     */
    public function fields(): array
    {
        $data = $this->validated();
        unset($data['reason']);

        return $data;
    }
}
