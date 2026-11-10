<?php

namespace App\Http\Responses\Staff;

use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Contracts\FailedPasswordResetResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * A failed staff password reset names no reason (SEC-P1-02): the broker's "no user with this address" would tell which
 * addresses belong to staff, so an unknown address gets the same answer as a wrong or expired link.
 *
 * The same time as well, and that is not done here: PasswordBroker::reset() pads every failed outcome to the staff timebox
 * (config/auth.php, TimeboxedPasswordBrokerManager), which lies above the hash check of a wrong token for a known address.
 * A dummy hash in this class would run after that floor, for an unknown address only, and turn the gap around (as the extra
 * hash of SEC-P1-19 did on the link request). StaffResetTimingTest measures both steps at the production cost.
 */
final class StaffPasswordResetFailed implements FailedPasswordResetResponse
{
    /**
     * @param  Request  $request
     */
    public function toResponse($request): Response
    {
        $message = (string) __('staff_auth.reset_failed');

        if ($request->wantsJson()) {
            throw ValidationException::withMessages(['email' => [$message]]);
        }

        return back()->withInput($request->only('email'))->withErrors(['email' => $message]);
    }
}
