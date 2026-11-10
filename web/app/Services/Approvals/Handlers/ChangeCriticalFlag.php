<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Config\UpdateFeatureFlag;
use App\Models\ApprovalRequest;
use App\Models\FeatureFlag;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\FourEyes;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * flags.critical_change (ADM-36, 06 §2 "production-critical flag change"): any change to a flag that is (or becomes) critical, in
 * production. Payload {flag_id, changes: {enabled?, staff_only?, percentage?, critical?, description?}, updated_at}: at approval the flag
 * must be unchanged since the request (its updated_at), so the approver approves what they saw.
 */
final class ChangeCriticalFlag implements ApprovalHandler
{
    public function __construct(private readonly UpdateFeatureFlag $update) {}

    public function key(): string
    {
        return 'flags.critical_change';
    }

    public function atom(): string
    {
        return 'flags.manage';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, [
            'flag_id' => ['required', 'integer'],
            'changes' => ['required', 'array'],
            'updated_at' => ['required', 'string'],
        ])->validate();

        $flag = FeatureFlag::query()->find((int) $payload['flag_id']);

        if ($flag === null || $flag->updated_at?->toIso8601ZuluString() !== $payload['updated_at']) {
            throw ValidationException::withMessages(['flag_id' => [(string) __('content.approvals.changed')]]);
        }

        $this->update->validated($flag, $payload['changes']);
    }

    public function describe(array $payload): array
    {
        $flag = FeatureFlag::query()->find((int) ($payload['flag_id'] ?? 0));
        $before = $flag === null ? [] : UpdateFeatureFlag::state($flag);
        $lines = [];

        foreach (is_array($payload['changes'] ?? null) ? $payload['changes'] : [] as $field => $value) {
            $lines[] = [
                'label' => 'approvals.flags_critical_change.'.$field,
                'before' => isset($before[$field]) ? json_encode($before[$field]) ?: null : null,
                'after' => json_encode($value) ?: null,
            ];
        }

        return ['title' => 'approvals.flags_critical_change.title', 'subject_label' => $flag?->getAttribute('key'), 'lines' => $lines];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'flags.critical_change');
        $requester = Staff::query()->findOrFail($request->requested_by);
        $flag = FeatureFlag::query()->findOrFail((int) $request->payload['flag_id']);

        $this->update->execute($requester, $approver, $flag, $request->payload['changes'], $request->reason);

        return ['flag' => $flag->getAttribute('key')];
    }
}
