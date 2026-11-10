<?php

namespace App\Http\Controllers\Api\V1\Me;

use App\Actions\Me\ConfirmTwoFactor;
use App\Actions\Me\DisableTwoFactor;
use App\Actions\Me\RegenerateRecoveryCodes;
use App\Actions\Me\StartTwoFactor;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Me\CodeRequest;
use App\Http\Requests\Api\V1\Me\PasswordRequest;
use App\Http\Requests\Api\V1\Me\SecondFactorRequest;
use App\Http\Resources\V1\RecoveryCodesResource;
use App\Http\Resources\V1\TwoFactorSetupResource;
use App\Models\User;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

class TwoFactorController extends Controller
{
    /**
     * Start two-factor setup (SET-05).
     *
     * Needs the `password` (422 on it when wrong) and a verified address (403 `email_not_verified`). Answers the key (32 base32
     * characters, 160 bits), its otpauth URL and a QR code as SVG, with Cache-Control: no-store. Pending until confirmed; starting again
     * replaces a pending key. Two-factor already on: 409 `conflict`.
     */
    public function store(PasswordRequest $request, StartTwoFactor $action): TwoFactorSetupResource
    {
        $user = $this->member($request->user());

        return new TwoFactorSetupResource($action->handle($user, $request->string('password')->toString()));
    }

    /**
     * Confirm two-factor setup (SET-05).
     *
     * The first six-digit code from the authenticator app. Switches two-factor on and answers the ten recovery codes, shown this once
     * (Cache-Control: no-store). Wrong code: 422 on `code`. Nothing pending or already on: 409 `conflict`.
     */
    public function confirm(CodeRequest $request, ConfirmTwoFactor $action): RecoveryCodesResource
    {
        $user = $this->member($request->user());

        return new RecoveryCodesResource($action->handle($user, $request->string('code')->toString()));
    }

    /**
     * Switch two-factor off (SET-05).
     *
     * `password` and `code` in the JSON body (never in the URL): a current authenticator code or an unused recovery code. Wrong: 422 on the field. Not on: 409 `conflict`.
     */
    public function destroy(SecondFactorRequest $request, DisableTwoFactor $action): Response
    {
        $user = $this->member($request->user());

        $action->handle($user, $request->string('password')->toString(), $request->string('code')->toString());

        return response()->noContent();
    }

    /**
     * New recovery codes (SET-05).
     *
     * `password` and `code` as for switching off. Ten new codes replace all old ones; shown this once (Cache-Control: no-store).
     */
    public function recoveryCodes(SecondFactorRequest $request, RegenerateRecoveryCodes $action): RecoveryCodesResource
    {
        $user = $this->member($request->user());

        return new RecoveryCodesResource($action->handle($user, $request->string('password')->toString(), $request->string('code')->toString()));
    }

    private function member(mixed $user): User
    {
        /** @var User $user */
        Gate::authorize('update', $user);

        return $user;
    }
}
