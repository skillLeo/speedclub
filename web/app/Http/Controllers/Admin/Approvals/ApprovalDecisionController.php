<?php

namespace App\Http\Controllers\Admin\Approvals;

use App\Enums\ApprovalStatus;
use App\Http\Controllers\Admin\Approvals\Requests\ApprovalCommentRequest;
use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\ApprovalConflict;
use App\Services\Approvals\Approvals;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * ADM-43 decisions (ADR-214): approve (comment optional) and deny (comment required) by a different staff member holding
 * approvals.decide and the action's atoms, recent password; cancel by the requester. Approvals::approve() is the only executor.
 * A request that is no longer pending answers with a flash, not an error page.
 */
class ApprovalDecisionController extends Controller
{
    public function approve(ApprovalCommentRequest $request, ApprovalRequest $approval, Approvals $approvals): RedirectResponse
    {
        try {
            $done = $approvals->approve($approval, $request->staff(), $request->comment());
        } catch (ApprovalConflict) {
            return back(303)->with('error', 'approvals.flash.conflict');
        }

        return match ($done->status) {
            ApprovalStatus::Executed => back(303)->with('success', 'approvals.flash.approved'),
            ApprovalStatus::Expired => back(303)->with('error', 'approvals.flash.expired'),
            default => back(303)->with('error', 'approvals.flash.failed'),
        };
    }

    public function deny(ApprovalCommentRequest $request, ApprovalRequest $approval, Approvals $approvals): RedirectResponse
    {
        try {
            $approvals->deny($approval, $request->staff(), (string) $request->comment());
        } catch (ApprovalConflict) {
            return back(303)->with('error', 'approvals.flash.conflict');
        }

        return back(303)->with('success', 'approvals.flash.denied');
    }

    public function cancel(Request $request, ApprovalRequest $approval, Approvals $approvals): RedirectResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        try {
            $approvals->cancel($approval, $staff);
        } catch (ApprovalConflict) {
            return back(303)->with('error', 'approvals.flash.conflict');
        }

        return back(303)->with('success', 'approvals.flash.cancelled');
    }
}
