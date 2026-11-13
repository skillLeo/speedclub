<?php

namespace App\Http\Requests\Api\V1\Businesses;

use Illuminate\Foundation\Http\FormRequest;

/**
 * BIZ-03 Team: a member (their @username) joins the business as staff.
 */
class AddMemberRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['username' => ['required', 'string', 'regex:/\A@?[A-Za-z0-9._]{1,40}\z/']];
    }

    public function username(): string
    {
        return mb_strtolower(ltrim((string) $this->validated('username'), '@'));
    }
}
