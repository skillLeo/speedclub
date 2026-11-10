<?php

namespace App\Http\Controllers\Admin\Moderation;

use App\Actions\Admin\Moderation\AssignCase;
use App\Actions\Admin\Moderation\DecideAppeal;
use App\Actions\Admin\Moderation\DecideCaseAsStaff;
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
use InvalidArgumentException;

/**
 * ADM-20/21/22 writes: take or reassign a case, decide it (a suspension only asks for the approval), decide an appeal (another person
 * than the decider; the Action refuses the same one). Thin: each calls its Action and answers with a flash key.
 */
class CaseActionsController extends Controller
{
    public function assign(AssignCaseRequest $request, string $case, AssignCase $assign): RedirectResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $to = $request->filled('staff_id') ? Staff::query()->find($request->integer('staff_id')) : null;
        abort_if($request->filled('staff_id') && $to === null, 422);

        return $this->run(fn () => $assign->handle($staff, self::case($case), $to), $to === null || $to->id === $staff->id ? 'moderation.flash.taken' : 'moderation.flash.reassigned');
    }

    public function decide(DecideCaseRequest $request, string $case, DecideCaseAsStaff $decide): RedirectResponse
    {
        try {
            $result = $decide->handle($request->staff(), self::case($case), $request->action(), $request->restriction(), $request->until(), $request->statement(), $request->reason());
        } catch (DomainException|InvalidArgumentException) {
            return back(303)->with('error', 'moderation.flash.not_possible');
        }

        return $result instanceof ApprovalRequest
            ? back(303)->with('approval', ApprovalsGateway::flash($result))
            : back(303)->with('success', 'moderation.flash.decided');
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
