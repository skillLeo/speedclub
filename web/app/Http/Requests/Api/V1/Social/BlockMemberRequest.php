<?php

namespace App\Http\Requests\Api\V1\Social;

use App\Models\User;
use App\Services\Garage\PublicMembers;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * No body: the name is in the path. Blocking yourself is a mistake of the request, so it answers 422 validation_failed.
 */
class BlockMemberRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $user = $this->user();
                $member = app(PublicMembers::class)->find((string) $this->route('username'));

                if ($user instanceof User && $member !== null && $member->is($user)) {
                    $validator->errors()->add('username', (string) __('social.block_self'));
                }
            },
        ];
    }
}
