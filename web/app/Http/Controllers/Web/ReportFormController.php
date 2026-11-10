<?php

namespace App\Http\Controllers\Web;

use App\Actions\Moderation\SubmitReport;
use App\Http\Controllers\Controller;
use App\Http\Requests\Web\ReportFormRequest;
use App\Mail\ReportReceivedMail;
use App\Services\Auth\AuthMailer;
use App\Services\Moderation\GuestReportMails;
use App\Services\Moderation\ReportTargets;
use App\Support\PublicUrl;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Response;

/**
 * WEB-09 /melden: the DSA notice form without an account (Art. 16, m2.6-contract §3). Sessionless on every request (ADR-115); the
 * confirmation is its own page after a 303, so a reload sends nothing twice. A given address gets the confirmation of receipt after
 * the response (AuthMailer), so the answer takes as long with an address as without. It names the canonical page of the target, and
 * one address gets at most speedclub.moderation.guest_mails_per_day such mails (confirmations and outcomes together).
 */
class ReportFormController extends Controller
{
    public function show(): Response
    {
        return response()->view('public.report', ['state' => 'form']);
    }

    public function store(ReportFormRequest $request, SubmitReport $action, AuthMailer $mailer, ReportTargets $targets, GuestReportMails $guestMails): RedirectResponse
    {
        $draft = $request->draft();
        $target = $request->target();
        $report = $action->handle($target, $draft);
        $url = $targets->publicUrl($target);

        // The canonical page of what was reported, never the typed text, and at most a few mails a day to one unverified address.
        if ($draft->contactEmail !== null && $url !== null && $guestMails->allow($draft->contactEmail)) {
            $mailer->sendLater($draft->contactEmail, app()->getLocale(), new ReportReceivedMail($report->id, $url, $draft->reason));
        }

        return redirect()->to(PublicUrl::to('/melden/gesendet'), 303);
    }

    public function sent(): Response
    {
        return response()->view('public.report', ['state' => 'sent']);
    }
}
