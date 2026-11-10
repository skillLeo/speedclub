<?php

namespace App\Services\Moderation;

use App\Enums\ReportTargetType;
use App\Models\Message;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Audit\Audit;
use App\Services\Garage\VehiclePresenter;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

/**
 * The evidence of a case (m3.4-contract §1, ADM-21/22): the encrypted snapshot each report kept of the target, and for a message the
 * reported message with its stored context (up to five before and after). Only for staff with moderation.view, and for a message target
 * only with moderation.messages; every opening is audited (`moderation.evidence_viewed`). If the conversation still exists, a staff
 * member may ask for up to ±10 live messages around the reported one (live(), MessagesTableEvidence::around), audited separately
 * (`moderation.live_context_viewed`). Nothing else of the conversation is reachable. Senders are named by role and, for the two
 * participants of the report, by username; never by e-mail.
 */
class CaseEvidence
{
    public const LIVE_CONTEXT = 10;

    public function __construct(
        private readonly MessagesTableEvidence $messages,
        private readonly VehiclePresenter $presenter,
    ) {}

    /**
     * @return array{target_type: string, participants: array{reported: string|null, reporter: string|null}|null, reports: list<array<string, mixed>>, live_available: bool}
     *
     * @throws AuthorizationException
     */
    public function reveal(ModerationCase $case, Staff $staff): array
    {
        $this->authorise($case, $staff);
        $reports = Report::query()->where('case_id', $case->id)->with('reporter:id,username')->orderBy('created_at')->orderBy('id')->get();
        $vehicles = $this->vehicleTitles(array_values($reports->all()));

        $rows = array_values($reports->map(function (Report $report) use ($vehicles): array {
            $evidence = is_array($report->evidence) ? $report->evidence : [];
            $messages = is_array($evidence['messages'] ?? null) ? $evidence['messages'] : [];

            return [
                'report_id' => $report->id,
                'reporter' => $report->reporter instanceof User ? $report->reporter->username : null,
                'source' => $report->source->value,
                'created_at' => $report->created_at->toIso8601String(),
                // The text the member wrote when it was reported (for a message only the conversation reference, never shown).
                // SEC-P3-17: a snapshot stored before the fix may still carry a mod's private notes; they never reach staff.
                'target' => $report->target_type === ReportTargetType::Message ? null : (is_array($evidence['target'] ?? null) ? self::withoutPrivate($evidence['target']) : null),
                'messages' => array_values(array_map(fn (mixed $row): array => self::message(is_array($row) ? $row : [], $vehicles), $messages)),
            ];
        })->all());

        DB::transaction(fn () => Audit::record('moderation.evidence_viewed', $case, null, [
            'case_id' => $case->id,
            'target_type' => $case->target_type->value,
            'reports' => count($rows),
            'messages' => array_sum(array_map(fn (array $row): int => count($row['messages']), $rows)),
        ], actor: $staff));

        return [
            'target_type' => $case->target_type->value,
            'participants' => $case->target_type === ReportTargetType::Message ? $this->participants($case) : null,
            'reports' => $rows,
            'live_available' => $this->liveSource($case) !== null,
        ];
    }

    /**
     * @return list<array<string, mixed>>
     *
     * @throws AuthorizationException
     */
    public function live(ModerationCase $case, Staff $staff): array
    {
        $this->authorise($case, $staff);
        $source = $this->liveSource($case);

        if ($source === null) {
            return [];
        }

        [$message, $reporterId] = $source;
        $rows = $this->messages->around($message, $reporterId, self::LIVE_CONTEXT);
        $vehicles = $this->vehicleTitlesById(array_values(array_filter(array_column($rows, 'vehicle_id'), is_string(...))));

        DB::transaction(fn () => Audit::record('moderation.live_context_viewed', $case, null, [
            'case_id' => $case->id,
            'messages' => count($rows),
        ], actor: $staff));

        return array_map(fn (array $row): array => self::message($row, $vehicles), $rows);
    }

    /**
     * @throws AuthorizationException
     */
    public static function authorise(ModerationCase $case, Staff $staff): void
    {
        if (! $staff->can('moderation.view') || ($case->target_type === ReportTargetType::Message && ! $staff->can('moderation.messages'))) {
            throw new AuthorizationException;
        }
    }

    /**
     * The reported message (if the conversation still exists) and the member whose view of it is read (the earliest member reporter).
     *
     * @return array{0: Message, 1: string}|null
     */
    private function liveSource(ModerationCase $case): ?array
    {
        if ($case->target_type !== ReportTargetType::Message) {
            return null;
        }

        $message = Message::query()->withoutGlobalScopes()->find($case->target_id);
        $reporterId = Report::query()->where('case_id', $case->id)->whereNotNull('reporter_id')->orderBy('created_at')->orderBy('id')->value('reporter_id');

        return $message instanceof Message && is_string($reporterId) ? [$message, $reporterId] : null;
    }

    /**
     * @return array{reported: string|null, reporter: string|null}
     */
    private function participants(ModerationCase $case): array
    {
        $reporterId = Report::query()->where('case_id', $case->id)->whereNotNull('reporter_id')->orderBy('created_at')->orderBy('id')->value('reporter_id');

        return [
            'reported' => $case->subject_id === null ? null : User::withTrashed()->whereKey($case->subject_id)->value('username'),
            'reporter' => is_string($reporterId) ? User::withTrashed()->whereKey($reporterId)->value('username') : null,
        ];
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  array<string, string>  $vehicles
     * @return array{id: string, from: string, type: string, body: string|null, vehicle: string|null, created_at: string|null, reported: bool}
     */
    private static function message(array $row, array $vehicles): array
    {
        $vehicle = is_string($row['vehicle_id'] ?? null) ? ($vehicles[$row['vehicle_id']] ?? null) : null;

        return [
            'id' => is_string($row['id'] ?? null) ? $row['id'] : '',
            'from' => is_string($row['from'] ?? null) ? $row['from'] : 'other',
            'type' => is_string($row['type'] ?? null) ? $row['type'] : 'text',
            'body' => is_string($row['body'] ?? null) ? $row['body'] : null,
            'vehicle' => $vehicle,
            'created_at' => is_string($row['created_at'] ?? null) ? $row['created_at'] : null,
            'reported' => ($row['reported'] ?? false) === true,
        ];
    }

    /**
     * @param  list<Report>  $reports
     * @return array<string, string>
     */
    private function vehicleTitles(array $reports): array
    {
        $ids = [];
        foreach ($reports as $report) {
            $messages = is_array($report->evidence['messages'] ?? null) ? $report->evidence['messages'] : [];
            foreach ($messages as $row) {
                if (is_array($row) && is_string($row['vehicle_id'] ?? null)) {
                    $ids[] = $row['vehicle_id'];
                }
            }
        }

        return $this->vehicleTitlesById($ids);
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, string>
     */
    private function vehicleTitlesById(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return Vehicle::query()->withoutGlobalScopes()->whereIn('id', array_unique($ids))->get()
            ->mapWithKeys(fn (Vehicle $vehicle): array => [$vehicle->id => $this->presenter->fullTitle($vehicle)])->all();
    }

    /**
     * @param  array<array-key, mixed>  $target
     * @return array<array-key, mixed>
     */
    private static function withoutPrivate(array $target): array
    {
        unset($target['notes']);

        return $target;
    }
}
