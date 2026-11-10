<?php

namespace App\Services\Auth;

use App\Enums\ErrorCode;
use App\Enums\StaffSecurityEvent;
use App\Models\Staff;
use App\Services\Audit\Audit;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

/**
 * The password of a signed-in staff session, at the confirmation (password.confirm.store) and at the password change
 * (user-password.update). Wrong answers count per account: after speedclub.staff.password_check_failures the account gets 429 until
 * the window ends, whichever session asks, so a stolen session cannot guess the password that unlocks every step behind
 * password.confirm (SEC-P1-26). Each wrong answer is audited. Correct answers are not counted, so the owner's own confirmations never
 * use the budget up.
 */
final class StaffPasswordCheck
{
    public function check(Staff $staff, string $password, string $field = 'password'): bool
    {
        $key = 'staff-password-check:'.$staff->getKey();
        $max = config()->integer('speedclub.staff.password_check_failures.max');

        if (RateLimiter::tooManyAttempts($key, $max)) {
            throw new HttpResponseException($this->locked($field, max(1, RateLimiter::availableIn($key))));
        }

        if ($password !== '' && Hash::check($password, $staff->getAuthPassword())) {
            return true;
        }

        RateLimiter::hit($key, config()->integer('speedclub.staff.password_check_failures.minutes') * 60);
        Audit::record(StaffSecurityEvent::PasswordCheckFailed->value, $staff, actor: $staff);

        return false;
    }

    private function locked(string $field, int $seconds): Response
    {
        $minutes = max(1, (int) ceil($seconds / 60));
        $message = (string) __('staff_auth.password_check_locked', ['time' => trans_choice('rate_limits.time.minutes', $minutes, ['count' => $minutes])]);
        $headers = ['Retry-After' => (string) $seconds];

        if (request()->expectsJson()) {
            return new JsonResponse(['message' => $message, 'code' => ErrorCode::RateLimited->value, 'errors' => [$field => [$message]]], 429, $headers);
        }

        // A browser form: nothing changes, the field says why. No withInput(): this is a password field.
        return back()->withErrors([$field => $message], $field === 'current_password' ? 'updatePassword' : 'default')->withHeaders($headers);
    }
}
