<?php

namespace App\Http\Controllers\Admin\Approvals;

use App\Enums\ApprovalStatus;
use App\Enums\DataExportStatus;
use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\DataExport;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Approvals\Approvals;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-43 approvals queue (06 §3 Team, ADR-214): Für mich (what this staff member may approve: approvals.decide plus the action's own
 * atoms), Von mir (what they asked for, with the download of an approved export for 24 hours), Alle (Owner and Admin). Each request
 * carries its summary lines (i18n keys, shown as a diff) and the reason; the payload itself never leaves the server.
 */
class ApprovalsController extends Controller
{
    public const TABS = ['for_me', 'mine', 'all'];

    public const STATUSES = ['pending', 'executing', 'executed', 'failed', 'denied', 'expired', 'cancelled'];

    public const LIMIT = 100;

    /** Failed records of a bulk result the page lists. */
    public const FAILED_ROWS = 20;

    public function __invoke(Request $request, Approvals $approvals): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $canDecide = $staff->can('approvals.decide');
        $canSeeAll = $staff->hasAnyRole(['owner', 'admin']);
        $tab = $request->query('tab');
        $tab = is_string($tab) && in_array($tab, self::TABS, true) ? $tab : ($canDecide ? 'for_me' : 'mine');
        $tab = match (true) {
            $tab === 'for_me' && ! $canDecide => 'mine',
            $tab === 'all' && ! $canSeeAll => 'mine',
            default => $tab,
        };
        $status = $request->query('status');
        $status = is_string($status) && in_array($status, self::STATUSES, true) ? $status : null;

        return Inertia::render('Approvals/Index', [
            'tab' => $tab,
            'status' => $status,
            'canDecide' => $canDecide,
            'canSeeAll' => $canSeeAll,
            'requests' => fn (): array => self::rows(self::list($tab, $status, $staff, $approvals), $staff, $approvals),
            'counts' => fn (): array => [
                'for_me' => $canDecide ? $approvals->pendingFor($staff)->count() : 0,
                'mine' => ApprovalRequest::query()->where('requested_by', $staff->getKey())->where('status', ApprovalStatus::Pending)->where('expires_at', '>', now())->count(),
                'all' => $canSeeAll ? ApprovalRequest::query()->where('status', ApprovalStatus::Pending)->where('expires_at', '>', now())->count() : 0,
            ],
        ]);
    }

    /**
     * @return list<ApprovalRequest>
     */
    private static function list(string $tab, ?string $status, Staff $staff, Approvals $approvals): array
    {
        if ($tab === 'for_me') {
            return array_values($approvals->pendingFor($staff)->all());
        }

        $query = ApprovalRequest::query()->with(['requester:id,name', 'decider:id,name']);
        if ($tab === 'mine') {
            $query->where('requested_by', $staff->getKey());
        }
        if ($status !== null) {
            $query->where('status', $status);
        }

        return array_values($query->orderByDesc('created_at')->orderByDesc('id')->limit(self::LIMIT)->get()->all());
    }

    /**
     * @param  list<ApprovalRequest>  $requests
     * @return list<array<string, mixed>>
     */
    private static function rows(array $requests, Staff $staff, Approvals $approvals): array
    {
        return array_map(function (ApprovalRequest $r) use ($staff, $approvals): array {
            $pending = $r->isPending() && ! $r->hasExpired();
            $result = is_array($r->result) ? $r->result : [];
            $summary = $r->summary;

            return [
                'id' => $r->id,
                'action' => $r->action,
                'title' => $summary['title'],
                'subject_label' => $summary['subject_label'] ?? null,
                'lines' => array_map(fn (array $line): array => [
                    'label' => $line['label'],
                    'before' => $line['before'] ?? null,
                    'after' => $line['after'] ?? null,
                ], $summary['lines']),
                'reason' => $r->reason,
                'requested_by' => $r->requester->name ?? null,
                'mine' => $r->requested_by === $staff->getKey(),
                'status' => $pending ? 'pending' : ($r->isPending() ? 'expired' : $r->status->value),
                'created_at' => $r->created_at?->toIso8601String(),
                'expires_at' => $r->expires_at->toIso8601String(),
                // Seconds left on the server's clock while pending (0 otherwise): the page counts down from this, not from the browser's
                // clock (skew, ?qaNow during captures).
                'expires_in' => $pending ? max(0, (int) now()->diffInSeconds($r->expires_at, false)) : 0,
                'decided_by' => $r->decider->name ?? null,
                'decided_at' => $r->decided_at?->toIso8601String(),
                'decision_comment' => $r->decision_comment,
                'result' => [
                    'done' => is_int($result['done'] ?? null) ? $result['done'] : null,
                    'failed' => is_int($result['failed'] ?? null) ? $result['failed'] : null,
                    'error' => is_string($result['error'] ?? null) ? $result['error'] : null,
                    'failed_rows' => self::failedRows($result),
                ],
                'can_decide' => $pending && $approvals->mayDecide($r, $staff),
                'can_cancel' => $pending && $r->requested_by === $staff->getKey(),
                'download' => $r->requested_by === $staff->getKey() ? self::download($r, $approvals, $staff) : null,
            ];
        }, $requests);
    }

    /**
     * The records a bulk run could not change (result.rows with ok = false), at most FAILED_ROWS, named for people: '@username' for a
     * member, the vehicle's title for a vehicle, else the id.
     *
     * @param  array<string, mixed>  $result
     * @return list<array{id: string, label: string, code: string|null}>
     */
    private static function failedRows(array $result): array
    {
        $rows = is_array($result['rows'] ?? null) ? $result['rows'] : [];
        $failed = [];
        foreach ($rows as $row) {
            if (is_array($row) && ($row['ok'] ?? true) === false && is_string($row['id'] ?? null)) {
                $failed[] = ['id' => $row['id'], 'code' => is_string($row['code'] ?? null) ? $row['code'] : null];
            }
            if (count($failed) >= self::FAILED_ROWS) {
                break;
            }
        }
        if ($failed === []) {
            return [];
        }

        $ids = array_column($failed, 'id');
        $members = User::withTrashed()->whereIn('id', $ids)->pluck('username', 'id');
        $vehicles = Vehicle::withTrashed()->with(['make', 'vehicleModel', 'generation'])->whereIn('id', $ids)->get()->keyBy('id');
        $presenter = app(VehiclePresenter::class);

        return array_map(function (array $row) use ($members, $vehicles, $presenter): array {
            $username = $members[$row['id']] ?? null;
            $vehicle = $vehicles->get($row['id']);
            $label = match (true) {
                is_string($username) && $username !== '' => '@'.$username,
                $vehicle instanceof Vehicle => $presenter->fullTitle($vehicle),
                default => $row['id'],
            };

            return ['id' => $row['id'], 'label' => $label, 'code' => $row['code']];
        }, $failed);
    }

    /**
     * The file an executed export produced, for its requester while it is downloadable: the audit export through its signed link, a
     * member export (SET-12 ZIP, built after approval) through the member record's download route once it is ready.
     */
    private static function download(ApprovalRequest $request, Approvals $approvals, Staff $staff): ?string
    {
        if ($request->status !== ApprovalStatus::Executed) {
            return null;
        }

        if ($request->action === 'members.export' && is_string($request->result['export_id'] ?? null) && $staff->can('members.export')) {
            $export = DataExport::query()->find($request->result['export_id']);

            return $export instanceof DataExport && $export->status === DataExportStatus::Ready && $export->isDownloadable()
                ? route('admin.members.exports.download', ['member' => $export->user_id, 'export' => $export->id], false)
                : null;
        }

        return $approvals->downloadUrl($request);
    }
}
