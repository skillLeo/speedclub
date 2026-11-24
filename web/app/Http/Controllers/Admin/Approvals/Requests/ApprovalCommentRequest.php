<?php

namespace App\Http\Controllers\Admin\Approvals\Requests;

use App\Models\Staff;
use Illuminate\Foundation\Http\FormRequest;

/** ADM-43 approve / deny: `approvals.decide`; the comment is optional on both (ADR-540: no required reason), 3–1000 characters. */
class ApprovalCommentRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');

        return $staff instanceof Staff && $staff->can('approvals.decide');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return ['comment' => ['nullable', 'string', 'min:3', 'max:1000']];
    }

    public function staff(): Staff
    {
        /** @var Staff $staff */
        $staff = $this->user('staff');

        return $staff;
    }

    public function comment(): ?string
    {
        $comment = $this->input('comment');

        return is_string($comment) && trim($comment) !== '' ? trim($comment) : null;
    }
}
