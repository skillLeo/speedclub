<?php

namespace App\Http\Controllers\Admin\Moderation;

use App\Actions\Admin\Moderation\AssignCase;
use App\Actions\Admin\Moderation\DecideAppeal;
use App\Actions\Admin\Moderation\DecideCaseAsStaff;
use App\Actions\Admin\Moderation\ReleaseCase;
use App\Http\Controllers\Admin\Moderation\Requests\AssignCaseRequest;
use App\Http\Controllers\Admin\Moderation\Requests\DecideAppealRequest;
use App\Http\Controllers\Admin\Moderation\Requests\DecideCaseRequest;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Controller;
use App\Models\Appeal;
use App\Models\ApprovalRequest;
use App\Models\ModerationCase;
use App\Models\Staff;
use Closure;
use DomainException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;

/**
 * ADM-20/21/22 writes: take or reassign a case, decide it (a suspension only asks for the approval), decide an appeal (another person
 * than the decider; the Action refuses the same one). Thin: each calls its Action and answers with a flash key.
 */
class CaseActionsController extends Controller
{
    /** Session flash: the case just decided ({id, reference, outcome, approval}), for the SplitQueue's toast and auto-advance. */
    public const DECIDED = 'moderation.decided';

    /** Session flash: the case just taken ({id, reference}), for the 5-s undo of the SplitQueue. */
    public const TAKEN = 'moderation.taken';

    /** Session key per case: what a take replaced and until when it can be undone (ReleaseCase). Never sent by the client. */
    private const UNDO = 'moderation.undo_take.';

    private const UNDO_SECONDS = 10;

    public function assign(AssignCaseRequest $request, string $case, AssignCase $assign): RedirectResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $to = $request->filled('staff_id') ? Staff::query()->find($request->integer('staff_id')) : null;
        abort_if($request->filled('staff_id') && $to === null, 422);
        $row = self::case($case);
        $before = ['assigned_staff_id' => $row->assigned_staff_id === null ? null : (int) $row->assigned_staff_id, 'status' => $row->status->value];
        $taking = $to === null || $to->id === $staff->id;

        try {
            $assign->handle($staff, $row, $to);
        } catch (DomainException|InvalidArgumentException) {
            return back(303)->with('error', 'moderation.flash.not_possible');
        }

        if (! $taking) {
            return back(303)->with('success', 'moderation.flash.reassigned');
        }

        $request->session()->put(self::UNDO.$row->id, [...$before, 'until' => now()->addSeconds(self::UNDO_SECONDS)->getTimestamp()]);

        return back(303)->with('success', 'moderation.flash.taken')->with(self::TAKEN, ['id' => $row->id, 'reference' => strtoupper(substr($row->id, -8))]);
    }

    /** The 5-s undo of "Übernehmen" (ReleaseCase), only with the record this session's take left. */
    public function release(Request $request, string $case, ReleaseCase $release): RedirectResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $row = self::case($case);
        $before = $request->session()->pull(self::UNDO.$row->id);

        if (! is_array($before) || (int) ($before['until'] ?? 0) < now()->getTimestamp()) {
            return back(303)->with('error', 'moderation.flash.undo_expired');
        }

        return $this->run(fn () => $release->handle($staff, $row, [
            'assigned_staff_id' => is_int($before['assigned_staff_id'] ?? null) ? $before['assigned_staff_id'] : null,
            'status' => is_string($before['status'] ?? null) ? $before['status'] : 'new',
        ]), 'moderation.flash.released');
    }

    public function decide(DecideCaseRequest $request, string $case, DecideCaseAsStaff $decide): RedirectResponse
    {
        try {
            $result = $decide->handle($request->staff(), self::case($case), $request->action(), $request->restriction(), $request->until(), $request->statement(), $request->reason());
        } catch (DomainException|InvalidArgumentException) {
            return back(303)->with('error', 'moderation.flash.not_possible');
        }

        $decided = [
            'id' => strtolower($case),
            'reference' => strtoupper(substr(strtolower($case), -8)),
            'outcome' => $request->action()->value,
            'approval' => $result instanceof ApprovalRequest,
        ];

        return $result instanceof ApprovalRequest
            ? back(303)->with('approval', ApprovalsGateway::flash($result))->with(self::DECIDED, $decided)
            : back(303)->with('success', 'moderation.flash.decided')->with(self::DECIDED, $decided);
    }

    public function decideAppeal(DecideAppealRequest $request, string $appeal, DecideAppeal $decide): RedirectResponse
    {
        $row = Appeal::query()->find(strtolower($appeal));
        abort_if($row === null, 404);

        return $this->run(fn () => $decide->handle(
            $request->staff(),
            $row,
            $request->outcome(),
            $request->string('explanation')->value(),
            $request->reason(),
            $request->measure(),
        ), 'moderation.flash.appeal_decided');
    }

    public static function case(string $id): ModerationCase
    {
        $case = ModerationCase::query()->find(strtolower($id));
        abort_if($case === null, 404);

        return $case;
    }

    /**
     * @param  Closure(): mixed  $action
     */
    private function run(Closure $action, string $flash): RedirectResponse
    {
        try {
            $action();
        } catch (DomainException|InvalidArgumentException) {
            return back(303)->with('error', 'moderation.flash.not_possible');
        }

        return back(303)->with('success', $flash);
    }
}
