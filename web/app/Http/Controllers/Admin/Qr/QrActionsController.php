<?php

namespace App\Http\Controllers\Admin\Qr;

use App\Actions\Admin\Qr\ReissueQrCodeAsStaff;
use App\Actions\Admin\Qr\RevokeQrCode;
use App\Http\Controllers\Admin\Qr\Requests\QrChangeRequest;
use App\Http\Controllers\Admin\Support\RecordLookup;
use App\Http\Controllers\Controller;
use DomainException;
use Illuminate\Http\RedirectResponse;

/** ADM-19 "Sperren" / "Neu ausgeben" (`qr.revoke`, recent password, reason; the owner is mailed by the Actions). */
class QrActionsController extends Controller
{
    public function revoke(QrChangeRequest $request, string $qr, RevokeQrCode $revoke): RedirectResponse
    {
        try {
            $revoke->handle($request->staff(), RecordLookup::qr($qr), $request->reason());
        } catch (DomainException) {
            return back(303)->with('error', 'qr.flash.not_possible');
        }

        return back(303)->with('success', 'qr.flash.revoked');
    }

    public function reissue(QrChangeRequest $request, string $qr, ReissueQrCodeAsStaff $reissue): RedirectResponse
    {
        try {
            $new = $reissue->handle($request->staff(), RecordLookup::qr($qr), $request->reason());
        } catch (DomainException) {
            return back(303)->with('error', 'qr.flash.not_possible');
        }

        return redirect()->route('admin.qr.show', ['qr' => $new->id])->setStatusCode(303)->with('success', 'qr.flash.reissued');
    }
}
