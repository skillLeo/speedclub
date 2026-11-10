<?php

namespace App\Http\Controllers\Admin\Support;

use App\Enums\ApprovalStatus;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\Approvals;

/**
 * The admin UI's door to the four-eyes engine (ADR-214, contract §1.5). Controllers never execute a four-eyes action: they call
 * request() and answer with the pending request as the flash `approval`. Summary titles are admin i18n keys (approvals.*).
 */
class ApprovalsGateway
{
    public function __construct(private readonly Approvals $approvals) {}

    /**
     * @param  array<string, mixed>  $payload
     * @return array{id: string, title: string, expires_at: string} the flash `approval`
     */
    public function request(string $action, array $payload, string $reason, Staff $by): array
    {
        return self::flash($this->approvals->request($action, $payload, $reason, $by));
    }

    /**
     * What this staff member may approve, newest first (ADM-08, ADM-43).
     *
     * @return list<array{id: string, action: string, title: string, subject_label: string|null, requested_by: string, reason: string, expires_at: string}>
     */
    public function pendingFor(Staff $staff): array
    {
        return array_values($this->approvals->pendingFor($staff)->map(fn (ApprovalRequest $request): array => [
            'id' => $request->id,
            'action' => $request->action,
            'title' => $request->summary['title'],
            'subject_label' => $request->summary['subject_label'] ?? null,
            'requested_by' => $request->requester->name ?? '',
            'reason' => $request->reason,
            'expires_at' => $request->expires_at->toIso8601String(),
        ])->all());
    }

    /**
     * Files of this staff member's executed requests that are still inside the download window (audit export, later member export).
     *
     * @return list<array{id: string, action: string, title: string, url: string, until: string}>
     */
    public function downloadsFor(Staff $staff): array
    {
        $since = now()->subHours(config()->integer('speedclub.approvals.download_hours'));

        $requests = ApprovalRequest::query()
            ->where('requested_by', $staff->getKey())
            ->where('status', ApprovalStatus::Executed)
            ->where('executed_at', '>', $since)
            ->latest('executed_at')
            ->limit(20)
            ->get();

        $downloads = [];
        foreach ($requests as $request) {
            $url = $this->approvals->downloadUrl($request);
            $until = Approvals::downloadUntil($request);

            if ($url !== null && $until !== null) {
                $downloads[] = ['id' => $request->id, 'action' => $request->action, 'title' => $request->summary['title'], 'url' => $url, 'until' => $until->toIso8601String()];
            }
        }

        return $downloads;
    }

    public function pendingCount(Staff $staff): int
    {
        return $this->approvals->countFor($staff);
    }

    /**
     * The flash of a four-eyes request. `existing`: the same request was already pending (Approvals::request() returned it instead of a
     * new one, review N-1), so the notice says it waits already.
     *
     * @return array{id: string, title: string, expires_at: string, existing: bool}
     */
    public static function flash(ApprovalRequest $request): array
    {
        return [
            'id' => $request->id,
            'title' => $request->summary['title'],
            'expires_at' => $request->expires_at->toIso8601String(),
            'existing' => ! $request->wasRecentlyCreated,
        ];
    }
}
