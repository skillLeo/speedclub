<?php

namespace App\Services\Approvals\Handlers;

use App\Actions\Admin\Vehicles\BulkHideVehicles;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\Concerns\NamesAMember;
use App\Services\Approvals\FourEyes;
use App\Services\Approvals\RunsRecordByRecord;
use App\Services\Garage\VehiclePresenter;
use App\Services\Moderation\Statement;
use Illuminate\Support\Facades\Validator;

/**
 * vehicles.bulk_hide (ADM-11, ADR-214): hiding more than 100 vehicles. Payload {ids: list<ULID> (≤ 500), facts, ground,
 * ground_document, ground_section?}: one statement of reasons for all. Executes BulkHideVehicles::execute record by record after the
 * approval committed (RunsRecordByRecord, SF-3). The summary names the first SUMMARY_NAMES vehicles with their owners and how many
 * more (SEC-P3-08).
 */
final class HideVehiclesInBulk implements ApprovalHandler, RunsRecordByRecord
{
    use NamesAMember;

    public const SUMMARY_NAMES = 20;

    public function __construct(
        private readonly BulkHideVehicles $bulk,
        private readonly VehiclePresenter $presenter,
    ) {}

    public function key(): string
    {
        return 'vehicles.bulk_hide';
    }

    public function atom(): string
    {
        return 'vehicles.hide';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, [
            'ids' => ['required', 'array', 'min:1', 'max:'.BulkRunner::MAX_IDS],
            'ids.*' => ['string', 'size:26'],
            ...Statement::rules(),
        ])->validate();
    }

    public function describe(array $payload): array
    {
        $ids = is_array($payload['ids'] ?? null) ? array_values(array_filter($payload['ids'], is_string(...))) : [];
        $shown = array_slice($ids, 0, self::SUMMARY_NAMES);
        $section = is_string($payload['ground_section'] ?? null) ? ' '.$payload['ground_section'] : '';
        $vehicles = Vehicle::query()->withoutGlobalScopes()->with('owner:id,username')->whereIn('id', $shown)->get()->keyBy('id');
        $labels = array_map(function (string $id) use ($vehicles): string {
            $vehicle = $vehicles->get($id);

            if (! $vehicle instanceof Vehicle) {
                return $id;
            }

            $owner = $vehicle->owner?->username;

            return trim($this->presenter->fullTitle($vehicle)).(is_string($owner) ? ' (@'.$owner.')' : '');
        }, $shown);

        return [
            'title' => 'approvals.vehicles_bulk_hide.title',
            'subject_label' => null,
            'lines' => [
                ['label' => 'approvals.vehicles_bulk_hide.count', 'after' => (string) count($ids)],
                ['label' => 'approvals.vehicles_bulk_hide.vehicles', 'after' => implode(', ', $labels)],
                ...(count($ids) > count($shown) ? [['label' => 'approvals.vehicles_bulk_hide.more', 'after' => (string) (count($ids) - count($shown))]] : []),
                ['label' => 'approvals.vehicles_bulk_hide.ground', 'after' => (is_string($payload['ground_document'] ?? null) ? $payload['ground_document'] : '').$section],
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'vehicles.bulk_hide');
        $payload = $request->payload;
        /** @var list<string> $ids */
        $ids = $payload['ids'];

        $rows = $this->bulk->execute($this->requester($request), $approver, $ids, Statement::fromArray($payload), $request->reason);
        $done = count(array_filter($rows, fn (array $row): bool => $row['ok']));

        return ['done' => $done, 'failed' => count($rows) - $done, 'rows' => $rows];
    }
}
