<?php

namespace App\Http\Controllers\Admin\Businesses;

use App\Actions\Admin\Businesses\ReviewBusiness;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Admin\Businesses\Requests\BusinessApproveRequest;
use App\Http\Controllers\Admin\Businesses\Requests\BusinessDecisionRequest;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Controller;
use App\Models\Business;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * ADM-55/56 writes: verify, reject (reason for the applicant), reinstate, reopen (the SplitQueue's undo), and suspend, which is
 * four-eyes: it only creates the `business.suspend` approval request (flash `approval`); a second staff member approves it in ADM-43.
 * Thin: each calls its Action, which audits. Every write carries the `version` it was decided on.
 *
 * Answers like ADM-53: an Inertia visit goes back with the success flash and `businesses.decided`; a changed business with the error
 * `version` = `businesses.conflict.changed`, a state that no longer allows the action with `state` = `businesses.flash.not_possible`. A
 * JSON client gets 200 {status, version} or 409 {code, message}.
 */
class BusinessActionsController extends Controller
{
    public function verify(BusinessApproveRequest $request, string $business, ReviewBusiness $review): RedirectResponse|JsonResponse
    {
        return $this->run($request, 'verified', fn () => $review->verify($request->staff(), BusinessShowController::find($business), $request->optionalReason(), $request->version()));
    }

    public function reject(BusinessDecisionRequest $request, string $business, ReviewBusiness $review): RedirectResponse|JsonResponse
    {
        return $this->run($request, 'rejected', fn () => $review->reject($request->staff(), BusinessShowController::find($business), $request->reason(), $request->version()));
    }

    public function reinstate(BusinessDecisionRequest $request, string $business, ReviewBusiness $review): RedirectResponse|JsonResponse
    {
        return $this->run($request, 'reinstated', fn () => $review->reinstate($request->staff(), BusinessShowController::find($business), $request->reason(), $request->version()));
    }

    public function reopen(BusinessApproveRequest $request, string $business, ReviewBusiness $review): RedirectResponse|JsonResponse
    {
        return $this->run($request, 'reopened', fn () => $review->reopen($request->staff(), BusinessShowController::find($business), $request->optionalReason(), $request->version()));
    }

    public function suspend(BusinessDecisionRequest $request, string $business, ApprovalsGateway $approvals): RedirectResponse|JsonResponse
    {
        $model = BusinessShowController::find($business);

        if ($request->version() !== ReviewBusiness::version($model)) {
            return $this->refused($request, true);
        }

        $approval = $approvals->request('business.suspend', ['business_id' => $model->id, 'version' => $request->version()], $request->reason(), $request->staff());

        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['approval' => $approval], 202);
        }

        return back(303)->with('approval', $approval);
    }

    /**
     * @param  Closure(): Business  $action
     */
    private function run(Request $request, string $outcome, Closure $action): RedirectResponse|JsonResponse
    {
        try {
            $business = $action();
        } catch (ApiException $refused) {
            return $this->refused($request, $refused->errorCode === ErrorCode::EditConflict);
        }

        $version = ReviewBusiness::version($business);

        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['status' => $business->status->value, 'version' => $version]);
        }

        return back(303)->with('success', "businesses.flash.$outcome")->with(BusinessQueueController::DECIDED, [
            'id' => $business->id,
            'name' => $business->name,
            'outcome' => $outcome,
            'status' => $business->status->value,
            'version' => $version,
        ]);
    }

    private function refused(Request $request, bool $changed): RedirectResponse|JsonResponse
    {
        $key = $changed ? 'businesses.conflict.changed' : 'businesses.flash.not_possible';

        if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
            return response()->json(['code' => $changed ? 'changed_meanwhile' : 'not_possible', 'message' => $key], 409);
        }

        $back = back(303)->withErrors([$changed ? 'version' : 'state' => $key]);

        return $changed ? $back : $back->with('error', $key);
    }
}
