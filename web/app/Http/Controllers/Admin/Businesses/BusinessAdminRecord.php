<?php

namespace App\Http\Controllers\Admin\Businesses;

use App\Actions\Admin\Businesses\ReviewBusiness;
use App\Enums\BusinessStatus;
use App\Enums\CaseStatus;
use App\Enums\ModTagStatus;
use App\Enums\ReportTargetType;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Models\AuditEvent;
use App\Models\Business;
use App\Models\BusinessMember;
use App\Models\ModerationCase;
use App\Models\Staff;
use Carbon\CarbonImmutable;

/**
 * The props of ADM-55 rows and the ADM-56 record (09 §10.2/§10.3): what staff check before verifying (name, address, Impressum fields,
 * website and registry plausibility), the applicant's document note, the team, the portfolio, open reports and the business's audit
 * trail. The applicant is named by @username; never a member's e-mail (members.view_pii is ADM-10's). The business's own contact
 * e-mail is part of its public Impressum.
 */
final class BusinessAdminRecord
{
    /**
     * @param  list<Business>  $businesses
     * @return list<array<string, mixed>>
     */
    public static function rows(array $businesses): array
    {
        $ids = array_map(fn (Business $business): string => $business->id, $businesses);
        $reports = ModerationCase::query()->where('target_type', ReportTargetType::Business->value)->whereIn('target_id', $ids)
            ->whereIn('status', array_map(fn (CaseStatus $status): string => $status->value, array_filter(CaseStatus::cases(), fn (CaseStatus $status): bool => $status->isOpen())))
            ->groupBy('target_id')->selectRaw('target_id, count(*) as open')->pluck('open', 'target_id')->all();

        return array_map(fn (Business $business): array => [
            'id' => $business->id,
            'slug' => $business->slug,
            'name' => $business->name,
            'kind' => $business->kind->value,
            'city' => $business->city,
            'status' => $business->status->value,
            'legal_name' => $business->legal_name,
            'legal_form' => $business->legal_form->value,
            'submitted_at' => $business->submitted_at?->toIso8601String(),
            // Sent back with every decision (optimistic locking): a changed business is not decided.
            'version' => ReviewBusiness::version($business),
            // SLA timer of the SplitQueue: minutes since the application was sent.
            'waiting_minutes' => $business->status === BusinessStatus::Applied && $business->submitted_at instanceof CarbonImmutable
                ? (int) $business->submitted_at->diffInMinutes(now()) : null,
            'owner' => [
                'id' => $business->owner_id,
                'username' => $business->owner->username,
                'joined_at' => $business->owner->created_at?->toIso8601String(),
            ],
            'open_reports' => (int) ($reports[$business->id] ?? 0),
            'removed' => $business->removed_at !== null,
            'is_sample' => $business->is_sample,
        ], $businesses);
    }

    /**
     * @return array<string, mixed>
     */
    public static function detail(Business $business, Staff $staff): array
    {
        $business->loadMissing(['owner', 'logo', 'cover', 'reviewer']);
        $row = self::rows([$business])[0];
        $decide = $staff->can('moderation.decide');

        return [
            ...$row,
            'about' => $business->about,
            'services' => $business->services ?? [],
            'opening_hours' => $business->opening_hours ?? (object) [],
            'impressum' => [
                'legal_name' => $business->legal_name,
                'legal_form' => $business->legal_form->value,
                'representative' => $business->representative,
                'street' => $business->street,
                'postcode' => $business->postcode,
                'city' => $business->city,
                'country' => $business->country,
                'email' => $business->email,
                'phone' => $business->phone,
                'website' => $business->website,
                'register_court' => $business->register_court,
                'register_number' => $business->register_number,
                'vat_id' => $business->vat_id,
            ],
            'needs_register' => $business->legal_form->needsRegister(),
            'point' => ['lat' => $business->lat, 'lng' => $business->lng],
            'document_note' => $business->getAttribute('document_note'),
            'logo' => MediaUrls::at($business->logo, 320),
            'cover' => MediaUrls::at($business->cover, 1080),
            'review' => [
                'reason' => $business->getAttribute('review_reason'),
                'reviewed_at' => $business->getAttribute('reviewed_at')?->toIso8601String(),
                'reviewed_by' => $business->reviewer?->name,
                'verified_at' => $business->verified_at?->toIso8601String(),
                'suspended_at' => $business->suspended_at?->toIso8601String(),
            ],
            'team' => BusinessMember::query()->with('user')->where('business_id', $business->id)->orderBy('created_at')->get()
                ->map(fn (BusinessMember $member): array => ['username' => $member->user->username, 'role' => $member->role->value])->all(),
            'tags' => [
                'accepted' => $business->tags()->where('status', ModTagStatus::Accepted->value)->count(),
                'pending' => $business->tags()->where('status', ModTagStatus::Pending->value)->count(),
            ],
            'cases' => ModerationCase::query()->where('target_type', ReportTargetType::Business->value)->where('target_id', $business->id)->orderByDesc('created_at')->limit(20)->get(['id', 'status', 'created_at'])
                ->map(fn (ModerationCase $case): array => ['id' => $case->id, 'status' => $case->status->value, 'created_at' => $case->created_at?->toIso8601String()])->all(),
            'history' => AuditEvent::query()->where('target_type', $business->getMorphClass())->where('target_id', $business->id)->orderByDesc('id')->limit(30)->get()
                ->map(fn (AuditEvent $audit): array => ['action' => $audit->getAttribute('action'), 'reason' => $audit->getAttribute('reason'), 'actor_type' => $audit->getAttribute('actor_type'), 'occurred_at' => (string) $audit->getAttribute('occurred_at')])->all(),
            'can' => [
                'verify' => $decide && $business->status === BusinessStatus::Applied,
                'reject' => $decide && $business->status === BusinessStatus::Applied,
                // Four-eyes: asking creates an approval request; a second staff member with moderation.decide approves it (ADM-43).
                'suspend' => $decide && $business->status === BusinessStatus::Verified,
                'reinstate' => $decide && $business->status === BusinessStatus::Suspended,
                'reopen' => $decide && ($business->status === BusinessStatus::Rejected || ($business->status === BusinessStatus::Verified && ! $business->tags()->exists())),
            ],
        ];
    }
}
