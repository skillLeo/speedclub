<?php

namespace App\Http\Responses\Staff;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse;
use Laravel\Fortify\Contracts\SuccessfulPasswordResetLinkRequestResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * One answer for every staff reset-link request (SEC-P1-02): sent, unknown address, the broker's 60 seconds per address and
 * the route limiter all look the same, so the form tells nobody which addresses belong to staff.
 *
 * Timing as well, and none of it happens here (SEC-P1-19): the mail leaves after the response
 * (Staff::sendPasswordResetNotification), and the broker pads every outcome to the staff timebox (config/auth.php,
 * TimeboxedPasswordBrokerManager), which lies above the hash of a new token. Extra work in this class would land on top of
 * that floor for some outcomes only and open the gap again.
 */
final class StaffResetLinkRequested implements FailedPasswordResetLinkRequestResponse, SuccessfulPasswordResetLinkRequestResponse
{
    /**
     * @param  Request  $request
     */
    public function toResponse($request): Response
    {
        $message = self::message();

        if ($request->wantsJson()) {
            return new JsonResponse(['message' => $message]);
        }

        return back()->with('status', $message);
    }

    public static function message(): string
    {
        $minutes = config()->integer('auth.passwords.'.config()->string('fortify.passwords').'.expire');

        return (string) __('staff_auth.reset_link_requested', [
            'duration' => trans_choice('rate_limits.time.minutes', $minutes, ['count' => $minutes]),
        ]);
    }
}
