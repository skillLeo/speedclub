<?php

namespace App\Http\Controllers\Admin\Privacy;

use App\Actions\Admin\Privacy\CompletePrivacyRequest;
use App\Actions\Admin\Privacy\DownloadPrivacyEvidence;
use App\Actions\Admin\Privacy\RequestPrivacyErasure;
use App\Actions\Admin\Privacy\SendPrivacyExport;
use App\Actions\Admin\Privacy\SendPrivacyReply;
use App\Actions\Admin\Privacy\UpdatePrivacyRequest;
use App\Enums\PrivacyReplyTemplate;
use App\Enums\PrivacyRequestStatus;
use App\Http\Controllers\Admin\Privacy\Requests\PrivacyStepRequest;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Admin\Team\TeamResponses;
use App\Http\Controllers\Controller;
use App\Models\PrivacyRequest;
use App\Models\Staff;
use App\Services\Team\TeamRefused;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * ADM-46 steps (`privacy.process`): assign, status, the one extension (with reason), a template reply, the member's own export by mail
 * (Auskunft/Export), the erasure through the four-eyes `members.delete` (Löschung), completing or rejecting with evidence; and the
 * evidence download (`privacy.view`, audited).
 */
class PrivacyRequestActionsController extends Controller
{
    use TeamResponses;

    public function update(PrivacyStepRequest $request, string $privacyRequest, UpdatePrivacyRequest $update): RedirectResponse
    {
        $row = self::find($privacyRequest);

        return $this->step(function () use ($request, $row, $update): void {
            if ($request->has('assigned_to')) {
                $assignee = $request->filled('assigned_to') ? Staff::query()->find($request->integer('assigned_to')) : null;

                if ($request->filled('assigned_to') && $assignee === null) {
                    throw ValidationException::withMessages(['assigned_to' => [__('privacy.validation.assignee')]]);
                }

                $update->assign($request->staff(), $row, $assignee);
            }

            if ($request->filled('status')) {
                $update->status($request->staff(), $row, PrivacyRequestStatus::from($request->string('status')->value()));
            }
        }, 'privacy.flash.updated');
    }

    public function extend(PrivacyStepRequest $request, string $privacyRequest, UpdatePrivacyRequest $update): RedirectResponse
    {
        return $this->step(fn () => $update->extend($request->staff(), self::find($privacyRequest), $request->string('reason')->value()), 'privacy.flash.extended');
    }

    public function reply(PrivacyStepRequest $request, string $privacyRequest, SendPrivacyReply $reply): RedirectResponse
    {
        $template = PrivacyReplyTemplate::tryFrom($request->string('template')->value());

        if ($template === null) {
            throw ValidationException::withMessages(['template' => [__('validation.required', ['attribute' => 'template'])]]);
        }

        return $this->step(fn () => $reply->handle(
            $request->staff(),
            self::find($privacyRequest),
            $template,
            $request->filled('locale') ? $request->string('locale')->value() : null,
            $request->filled('detail') ? $request->string('detail')->value() : null,
        ), 'privacy.flash.replied');
    }

    public function export(PrivacyStepRequest $request, string $privacyRequest, SendPrivacyExport $export): RedirectResponse
    {
        return $this->step(fn () => $export->handle($request->staff(), self::find($privacyRequest)), 'privacy.flash.export_sent');
    }

    public function erasure(PrivacyStepRequest $request, string $privacyRequest, RequestPrivacyErasure $erasure): RedirectResponse
    {
        try {
            $approval = $erasure->handle($request->staff(), self::find($privacyRequest), $request->string('reason')->value());
        } catch (TeamRefused $refused) {
            return back(303)->with('error', $refused->getMessage());
        }

        return back(303)->with('approval', ApprovalsGateway::flash($approval));
    }

    public function complete(PrivacyStepRequest $request, string $privacyRequest, CompletePrivacyRequest $complete): RedirectResponse
    {
        $outcome = PrivacyRequestStatus::tryFrom($request->string('status')->value()) ?? PrivacyRequestStatus::Completed;
        $file = $request->file('evidence');

        return $this->step(fn () => $complete->handle(
            $request->staff(),
            self::find($privacyRequest),
            $outcome,
            $request->filled('note') ? $request->string('note')->value() : null,
            $file instanceof UploadedFile ? $file : null,
        ), $outcome === PrivacyRequestStatus::Rejected ? 'privacy.flash.rejected' : 'privacy.flash.completed');
    }

    public function evidence(Request $request, string $privacyRequest, DownloadPrivacyEvidence $download): StreamedResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return $download->handle($staff, self::find($privacyRequest));
    }

    private static function find(string $id): PrivacyRequest
    {
        return PrivacyRequest::query()->findOrFail($id);
    }
}
