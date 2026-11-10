<?php

namespace App\Http\Controllers\Admin\Account;

use App\Actions\Admin\Account\CancelTotpRotation;
use App\Actions\Admin\Account\ConfirmTotpRotation;
use App\Actions\Admin\Account\RegenerateRecoveryCodes;
use App\Actions\Admin\Account\ShowRecoveryCodes;
use App\Actions\Admin\Account\StartTotpRotation;
use App\Http\Controllers\Admin\Account\Requests\CurrentCodeRequest;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\Team\TeamRefused;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ADM-51 code steps (SEC-P1-36, SEC-P1-39, ADR-238). Each answers JSON with `Cache-Control: no-store`, refused to an Inertia visit (409),
 * so a key, its QR code or a recovery code lives only in the page's memory and never in a prop, a flash, the session or a cache:
 * - start: a current code → a new pending key (key, otpauth URL, QR SVG, expiry), the old one keeps working;
 * - confirm: a code of the new key, from the same session → the new key replaces the old, other sessions end;
 * - cancel: the pending key goes;
 * - recovery codes: a current code → the codes (audited on view), or eight new ones.
 * A refusal answers {code, message} with its status (422, 409 rotation_elsewhere, 429 too_many_codes).
 */
class AccountTwoFactorController extends Controller
{
    public function start(CurrentCodeRequest $request, StartTotpRotation $start): JsonResponse
    {
        return $this->answer($request, fn (): array => $start->handle($request->staff(), $request->code(), $request->session()));
    }

    public function confirm(CurrentCodeRequest $request, ConfirmTotpRotation $confirm): JsonResponse
    {
        return $this->answer($request, function () use ($request, $confirm): array {
            $confirm->handle($request->staff(), $request->code(), $request->session());

            return ['confirmed' => true];
        });
    }

    public function cancel(Request $request, CancelTotpRotation $cancel): JsonResponse
    {
        return $this->answer($request, function () use ($request, $cancel): array {
            /** @var Staff $staff */
            $staff = $request->user('staff');
            $cancel->handle($staff);

            return ['cancelled' => true];
        });
    }

    public function showRecoveryCodes(CurrentCodeRequest $request, ShowRecoveryCodes $show): JsonResponse
    {
        return $this->answer($request, fn (): array => ['codes' => $show->handle($request->staff(), $request->code())]);
    }

    public function regenerateRecoveryCodes(CurrentCodeRequest $request, RegenerateRecoveryCodes $regenerate): JsonResponse
    {
        return $this->answer($request, fn (): array => ['codes' => $regenerate->handle($request->staff(), $request->code(), $request->session())]);
    }

    /**
     * @param  Closure(): array<string, mixed>  $step
     */
    private function answer(Request $request, Closure $step): JsonResponse
    {
        abort_if($request->header('X-Inertia') !== null, 409);

        try {
            return self::json($step());
        } catch (TeamRefused $refused) {
            return self::json(['code' => $refused->reason, 'message' => $refused->getMessage()], $refused->status());
        }
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private static function json(array $data, int $status = 200): JsonResponse
    {
        return response()->json($data, $status, ['Cache-Control' => 'no-store, private', 'Pragma' => 'no-cache']);
    }
}
