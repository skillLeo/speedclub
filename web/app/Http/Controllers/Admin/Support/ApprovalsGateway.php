<?php

namespace App\Http\Controllers\Admin\Support;

use App\Enums\ApprovalStatus;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\OwnerOverride;

/**
 * The admin UI's door to the four-eyes engine (ADR-214, contract §1.5). Controllers never execute a four-eyes action: they call
 * request() and answer with the pending request as the flash `approval` (ADR-540: with four-eyes off, the request has already run
 * as a direct action; the flash says so). Summary titles are admin i18n keys (approvals.*).
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
     * new one, review N-1), so the notice says it waits already. M5.1 (ADR-507): who can approve it (`approvers`, at most 5 names, and
     * `approvers_total`) and whether the signed-in staff member who sees the flash may execute it as an Owner-Override (`override`, SF-3:
     * computed for the viewer, never for the original requester of an `existing` request), so the notice never just waits.
     *
     * ADR-540: while four-eyes is off the request ran at once (`direct`): the shell shows a success toast (status executed) or the
     * refusal (status failed, `error`) instead of the waiting notice.
     *
     * @return array{id: string, title: string, expires_at: string, existing: bool, approvers: list<string>, approvers_total: int, override: bool, direct?: true, status?: string, error?: string|null}
     */
    public static function flash(ApprovalRequest $request): array
    {
        $base = [
            'id' => $request->id,
            'title' => $request->summary['title'],
            'expires_at' => $request->expires_at->toIso8601String(),
            'existing' => ! $request->wasRecentlyCreated,
        ];

        if (($request->result['direct'] ?? null) === true) {
            $error = $request->result['error'] ?? null;

            return [...$base, 'approvers' => [], 'approvers_total' => 0, 'override' => false, 'direct' => true, 'status' => $request->status->value, 'error' => is_string($error) ? $error : null];
        }

        return [...$base, ...self::waiting($request, self::viewer())];
    }

    private static function viewer(): ?Staff
    {
        $staff = auth('staff')->user();

        return $staff instanceof Staff ? $staff : null;
    }

    /**
     * Who can approve a pending request, and whether $viewer may override it (OwnerOverride::status()); nobody and no override for a
     * viewer who is gone.
     *
     * @return array{approvers: list<string>, approvers_total: int, override: bool}
     */
    public static function waiting(ApprovalRequest $request, ?Staff $viewer): array
    {
        if ($viewer === null) {
            return ['approvers' => [], 'approvers_total' => 0, 'override' => false];
        }

        return app(OwnerOverride::class)->status($request, $viewer);
    }
}
