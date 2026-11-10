<?php

namespace App\Http\Controllers\Admin\Config\Support;

use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Models\ApprovalRequest;
use App\Services\Config\ConfigRefused;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * How the M3.5 admin answers a write (m3.5 contract §6): a ConfigRefused becomes the error `refused` in words (config.refused.*) on the
 * page that sent it, or for a JSON call its status (409 draft_taken / stale_revision, else 422) with the same words; a four-eyes
 * outcome becomes the flash `approval` the shell turns into the ApprovalNotice; anything else the success flash.
 */
final class ConfigAnswers
{
    /**
     * @template T of Response
     *
     * @param  Closure(): T  $write
     * @return T|RedirectResponse|JsonResponse
     */
    public static function run(Request $request, Closure $write): Response
    {
        try {
            return $write();
        } catch (ConfigRefused $refused) {
            $text = AdminText::refusal($refused);

            if ($request->expectsJson() && ! $request->hasHeader('X-Inertia')) {
                return response()->json(['message' => $text, 'code' => $refused->reason], $refused->status());
            }

            return back(303)->withErrors(['refused' => $text])->with('refused', $refused->reason);
        }
    }

    /** A publish, rollback or flag change: the approval it created, or the success flash. */
    public static function outcome(?ApprovalRequest $approval, string $success): RedirectResponse
    {
        return $approval !== null ? back(303)->with('approval', ApprovalsGateway::flash($approval)) : back(303)->with('success', $success);
    }
}
