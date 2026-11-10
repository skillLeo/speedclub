<?php

namespace App\Actions\Admin\Support;

use App\Enums\SupportTicketStatus;
use App\Models\Staff;
use App\Models\SupportTicket;
use App\Services\Admin\Members\BulkOutcome;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-25 bulk status (`support.reply`, reason): up to 500 tickets, each through SetTicketStatus in its own transaction. Four-eyes
 * (`support.bulk_status`) above 100 records within 24 hours per staff member (06 §2 bulk rule, ADR-229). One `support.bulk_status`
 * event sums the run.
 */
class BulkTicketStatus
{
    public const EVENT = 'support.bulk_status';

    public function __construct(
        private readonly Approvals $approvals,
        private readonly SetTicketStatus $set,
    ) {}

    /**
     * @param  array<mixed>  $ids
     *
     * @throws AuthorizationException|ValidationException
     */
    public function handle(Staff $staff, array $ids, SupportTicketStatus $status, string $reason): BulkOutcome
    {
        StaffAtoms::ensure($staff, 'support.reply');
        $ids = BulkRunner::ids($ids);
        $ask = fn (): BulkOutcome => new BulkOutcome(approval: $this->approvals->request(self::EVENT, ['ids' => $ids, 'status' => $status->value], $reason, $staff));

        return BulkRunner::alone($staff, self::EVENT, $ask, function () use ($staff, $ids, $status, $reason, $ask): BulkOutcome {
            if (count($ids) + BulkRunner::recentDirect($staff, self::EVENT) > BulkRunner::APPROVAL_ABOVE) {
                return $ask();
            }

            return new BulkOutcome($this->run($staff, null, $ids, $status, trim($reason)));
        });
    }

    /**
     * Only from the `support.bulk_status` handler inside Approvals::approve() (FourEyes).
     *
     * @param  list<string>  $ids
     * @return list<array{id: string, ok: bool, code: string|null}>
     *
     * @throws AuthorizationException
     */
    public function execute(Staff $requester, ?Staff $approver, array $ids, SupportTicketStatus $status, string $reason): array
    {
        if ($approver === null) {
            throw new AuthorizationException;
        }

        FourEyes::ids(FourEyes::executor([self::EVENT], $requester, $approver, 'support.reply'), $ids);

        return $this->run($requester, $approver, $ids, $status, $reason);
    }

    /**
     * @param  list<string>  $ids
     * @return list<array{id: string, ok: bool, code: string|null}>
     */
    private function run(Staff $requester, ?Staff $approver, array $ids, SupportTicketStatus $status, string $reason): array
    {
        $rows = BulkRunner::each($ids, function (string $id) use ($requester, $status): bool {
            $ticket = SupportTicket::query()->find($id);

            if (! $ticket instanceof SupportTicket) {
                return false;
            }

            $this->set->handle($requester, $ticket, $status);

            return true;
        });

        $outcome = new BulkOutcome($rows);

        DB::transaction(fn () => Audit::record(self::EVENT, null, after: [
            'records' => count($ids),
            'status' => $status->value,
            ...$outcome->counts(),
            'requested_by' => $requester->getKey(),
            'approved_by' => $approver?->getKey(),
        ], reason: $reason, actor: $approver ?? $requester));

        return $rows;
    }
}
