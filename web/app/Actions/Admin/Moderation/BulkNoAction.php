<?php

namespace App\Actions\Admin\Moderation;

use App\Actions\Moderation\DecideCase;
use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Enums\ReportTargetType;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Services\Admin\Members\BulkOutcome;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use App\Services\Moderation\CaseRecord;
use App\Services\Moderation\DecisionInput;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-20 bulk "Keine Maßnahme" for spam waves (m3.4-contract §2; `moderation.decide`, recent password, reason): one no_action decision
 * per open case through DecideCase, each in its own transaction with its own audit event, the reporters told the outcome. Up to 500
 * cases; four-eyes (`moderation.bulk_no_action`) when this run plus what the same staff member closed this way without an approval in
 * the last 24 hours passes 100 (ADR-229), or while another run of theirs is still going. Message cases are skipped (`forbidden`) for
 * staff without moderation.messages. One `moderation.bulk_no_action` event sums the run.
 */
class BulkNoAction
{
    public const EVENT = 'moderation.bulk_no_action';

    public const FACTS = 'Sammelprüfung einer Meldewelle: kein Verstoß festgestellt.';

    public function __construct(
        private readonly Approvals $approvals,
        private readonly DecideCase $decide,
    ) {}

    /**
     * @param  array<mixed>  $ids
     *
     * @throws AuthorizationException|ValidationException
     */
    public function handle(Staff $staff, array $ids, string $reason): BulkOutcome
    {
        StaffAtoms::ensure($staff, 'moderation.decide');
        $ids = BulkRunner::ids($ids);
        $ask = fn (): BulkOutcome => new BulkOutcome(approval: $this->approvals->request(self::EVENT, ['ids' => $ids], $reason, $staff));

        return BulkRunner::alone($staff, self::EVENT, $ask, function () use ($staff, $ids, $reason, $ask): BulkOutcome {
            if (count($ids) + BulkRunner::recentDirect($staff, self::EVENT) > BulkRunner::APPROVAL_ABOVE) {
                return $ask();
            }

            return new BulkOutcome($this->run($staff, null, $ids, trim($reason)));
        });
    }

    /**
     * The approved run: only from the `moderation.bulk_no_action` handler while Approvals::approve() executes that request (FourEyes).
     *
     * @param  list<string>  $ids
     * @return list<array{id: string, ok: bool, code: string|null}>
     *
     * @throws AuthorizationException
     */
    public function execute(Staff $requester, ?Staff $approver, array $ids, string $reason): array
    {
        if ($approver === null) {
            throw new AuthorizationException;
        }

        FourEyes::ids(FourEyes::executor([self::EVENT], $requester, $approver, 'moderation.decide'), $ids);

        return $this->run($requester, $approver, $ids, $reason);
    }

    /**
     * @param  list<string>  $ids
     * @return list<array{id: string, ok: bool, code: string|null}>
     */
    private function run(Staff $requester, ?Staff $approver, array $ids, string $reason): array
    {
        $rows = BulkRunner::each($ids, function (string $id) use ($requester, $reason): bool {
            $case = ModerationCase::query()->find($id);

            if (! $case instanceof ModerationCase) {
                return false;
            }

            if ($case->target_type === ReportTargetType::Message && ! $requester->can('moderation.messages')) {
                throw new AuthorizationException;
            }

            if (! $case->status->isOpen()) {
                throw new DomainException('The case is not open.');
            }

            $this->decide->handle($case, new DecisionInput(
                action: DecisionAction::NoAction,
                facts: self::FACTS,
                ground: '',
                groundDocument: GroundDocument::Community,
                automatedDetection: CaseRecord::automatedDetection($case),
                decidedBy: $requester,
                reason: $reason,
            ));

            return true;
        });

        $outcome = new BulkOutcome($rows);

        DB::transaction(fn () => Audit::record(self::EVENT, null, after: [
            'records' => count($ids),
            ...$outcome->counts(),
            'requested_by' => $requester->getKey(),
            'approved_by' => $approver?->getKey(),
        ], reason: $reason, actor: $approver ?? $requester));

        return $rows;
    }
}
