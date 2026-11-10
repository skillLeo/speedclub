<?php

namespace App\Http\Controllers\Admin\Members\Requests;

use App\Actions\Admin\Members\BulkMemberAction;
use App\Enums\RestrictionType;
use App\Models\Staff;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Moderation\Statement;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** ADM-09 bulk: {action, ids[≤500], reason, (restrict: type, until?, statement of reasons)}. The atom is the action's own. */
class MemberBulkRequest extends FormRequest
{
    public function authorize(): bool
    {
        $staff = $this->user('staff');
        $action = $this->input('action');
        $atom = is_string($action) ? (BulkMemberAction::ATOMS[$action] ?? 'members.view') : 'members.view';

        return $staff instanceof Staff && $staff->can($atom);
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $restrict = $this->input('action') === 'restrict';

        return [
            'action' => ['required', 'string', Rule::in(BulkMemberAction::ACTIONS)],
            'ids' => ['required', 'array', 'min:1', 'max:'.BulkRunner::MAX_IDS],
            'ids.*' => ['required', 'string', 'ulid'],
            'reason' => ['required', 'string', 'min:10', 'max:1000'],
            'type' => [$restrict ? 'required' : 'prohibited', Rule::enum(RestrictionType::class)],
            'until' => [$restrict ? 'nullable' : 'prohibited', 'date', 'after:now'],
            ...($restrict ? Statement::rules() : []),
        ];
    }
}
