<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Businesses\ReviewBusiness;
use App\Enums\BusinessStatus;
use App\Models\ApprovalRequest;
use App\Models\Business;
use App\Models\Staff;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\FourEyes;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * business.suspend (09 §8.10, §10.2 "destructive → four-eyes with reason"; M4.14): suspending a verified business takes its page, its
 * badge and its portfolio offline, so a second staff member approves, like a member suspension. Payload: business_id, version (the
 * updated_at the requester decided on; a business changed since fails the approval). The request's reason reaches the owner.
 */
final class SuspendBusiness implements ApprovalHandler
{
    public function __construct(private readonly ReviewBusiness $review) {}

    public function key(): string
    {
        return 'business.suspend';
    }

    public function atom(): string
    {
        return 'moderation.decide';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, [
            'business_id' => ['required', 'string', 'size:26'],
            'version' => ['required', 'string', 'max:40'],
        ])->validate();

        $business = $this->business($payload);

        if ($business === null || $business->status !== BusinessStatus::Verified) {
            throw ValidationException::withMessages(['business_id' => ['The business is not verified.']]);
        }
    }

    public function describe(array $payload): array
    {
        $business = $this->business($payload);

        return [
            'title' => 'approvals.business_suspend.title',
            'subject_label' => $business?->name,
            'lines' => [
                ['label' => 'approvals.business_suspend.status', 'before' => $business?->status->value, 'after' => BusinessStatus::Suspended->value],
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'business.suspend');
        $requester = Staff::query()->findOrFail($request->requested_by);
        $business = $this->business($request->payload) ?? throw ValidationException::withMessages(['business_id' => ['The business is gone.']]);
        $version = $request->payload['version'] ?? '';

        $this->review->suspend($requester, $approver, $business, $request->reason, is_string($version) ? $version : '');

        return ['business_id' => $business->id];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function business(array $payload): ?Business
    {
        $id = $payload['business_id'] ?? null;

        return is_string($id) ? Business::query()->find(strtolower($id)) : null;
    }
}
