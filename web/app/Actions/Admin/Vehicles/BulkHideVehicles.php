<?php

namespace App\Actions\Admin\Vehicles;

use App\Enums\AdminMemberEvent;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Services\Admin\Members\BulkOutcome;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Moderation\Statement;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * ADM-11 bulk hide (`vehicles.hide`, recent password; reason and one statement of reasons for all): one remove_content decision per
 * vehicle through HideVehicle, each owner told, each in its own transaction (BulkRunner). Four-eyes (`vehicles.bulk_hide`) when this run
 * plus what the same staff member hid in bulk without an approval in the last 24 hours passes 100 vehicles (SF-4 / SEC-P3-08), or
 * while another bulk hide of theirs is still running; its handler calls execute() from Approvals::approve(), nowhere else (FourEyes).
 * One row per vehicle; one `vehicle.bulk_hidden` event sums the run (`records`, `done`, `failed`).
 */
class BulkHideVehicles
{
    public function __construct(
        private readonly Approvals $approvals,
        private readonly HideVehicle $hide,
    ) {}

    /**
     * @param  array<mixed>  $ids
     *
     * @throws AuthorizationException|ValidationException
     */
    public function handle(Staff $staff, array $ids, Statement $statement, string $reason): BulkOutcome
    {
        StaffAtoms::ensure($staff, 'vehicles.hide');
        Validator::make($statement->toArray(), Statement::rules())->validate();
        $ids = BulkRunner::ids($ids);
        $ask = fn (): BulkOutcome => new BulkOutcome(approval: $this->approvals->request('vehicles.bulk_hide', [
            'ids' => $ids,
            ...$statement->toArray(),
        ], $reason, $staff));

        return BulkRunner::alone($staff, 'vehicles.hide', $ask, function () use ($staff, $ids, $statement, $reason, $ask): BulkOutcome {
            if (count($ids) + BulkRunner::recentDirect($staff, AdminMemberEvent::VehicleBulkHidden->value) > BulkRunner::APPROVAL_ABOVE) {
                return $ask();
            }

            return new BulkOutcome($this->run($staff, null, $ids, $statement, trim($reason)));
        });
    }

    /**
     * The approved run: only from the `vehicles.bulk_hide` handler while Approvals::approve() executes that request (FourEyes).
     *
     * @param  list<string>  $ids
     * @return list<array{id: string, ok: bool, code: string|null}>
     *
     * @throws AuthorizationException
     */
    public function execute(Staff $requester, ?Staff $approver, array $ids, Statement $statement, string $reason): array
    {
        if ($approver === null) {
            throw new AuthorizationException;
        }

        FourEyes::ids(FourEyes::executor(['vehicles.bulk_hide'], $requester, $approver, 'vehicles.hide'), $ids);

        return $this->run($requester, $approver, $ids, $statement, $reason);
    }

    /**
     * @param  list<string>  $ids
     * @return list<array{id: string, ok: bool, code: string|null}>
     */
    private function run(Staff $requester, ?Staff $approver, array $ids, Statement $statement, string $reason): array
    {
        $rows = BulkRunner::each($ids, function (string $id) use ($requester, $statement, $reason): bool {
            $vehicle = Vehicle::query()->find($id);

            if (! $vehicle instanceof Vehicle) {
                return false;
            }

            $this->hide->handle($requester, $vehicle, $statement, $reason);

            return true;
        });

        $outcome = new BulkOutcome($rows);

        DB::transaction(fn () => Audit::record(AdminMemberEvent::VehicleBulkHidden->value, null, after: [
            'records' => count($ids),
            ...$outcome->counts(),
            'requested_by' => $requester->getKey(),
            'approved_by' => $approver?->getKey(),
        ], reason: $reason, actor: $approver ?? $requester));

        return $rows;
    }
}
