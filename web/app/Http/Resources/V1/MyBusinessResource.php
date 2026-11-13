<?php

namespace App\Http\Resources\V1;

use App\Enums\BusinessRole;
use App\Enums\BusinessStatus;
use App\Enums\ModTagInitiator;
use App\Enums\ModTagStatus;
use App\Models\Business;
use App\Models\BusinessMember;
use App\Services\Businesses\BusinessViews;
use Illuminate\Http\Request;

/**
 * BIZ-02 status screen and BIZ-03 Betriebs-Dashboard: the profile plus what only the team reads: status with the staff reason of a
 * rejection or suspension, the document note, the team, open tag requests and the private 30-day profile views. Never staff names.
 *
 * @property Business $resource
 */
class MyBusinessResource extends BusinessResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $business = $this->resource;
        $reason = in_array($business->status, [BusinessStatus::Rejected, BusinessStatus::Suspended], true) ? $business->getAttribute('review_reason') : null;

        return [
            ...parent::toArray($request),
            /** @var BusinessStatus */
            'status' => $business->status,
            /** Taken down by a moderation decision (SAFE-01 has the statement of reasons). */
            'removed' => $business->removed_at !== null,
            /** Why staff rejected or suspended it; null otherwise. @var string|null */
            'status_reason' => is_string($reason) ? $reason : null,
            /** @var string|null */
            'submitted_at' => $business->submitted_at?->toIso8601String(),
            /** @var string|null */
            'verified_at' => $business->verified_at?->toIso8601String(),
            /** @var string|null */
            'document_note' => $business->getAttribute('document_note'),
            /** Verified: name, legal form, address and register details change through support only. */
            'identity_locked' => in_array($business->status, [BusinessStatus::Verified, BusinessStatus::Suspended], true),
            /**
             * @var list<array{username: string|null, role: BusinessRole}>
             */
            'team' => $business->members()->with('user')->orderBy('created_at')->get()
                ->map(fn (BusinessMember $member): array => ['username' => $member->user->username, 'role' => $member->role])->values()->all(),
            /** Member requests waiting for the business (BIZ-04 badge). */
            'pending_requests' => $business->tags()->where('status', ModTagStatus::Pending->value)->where('initiated_by', ModTagInitiator::Member->value)->count(),
            /** Profile views of the last 30 days (Europe/Berlin), private to the team; the team's own views are not counted. */
            'views_30d' => app(BusinessViews::class)->lastDays($business),
        ];
    }
}
