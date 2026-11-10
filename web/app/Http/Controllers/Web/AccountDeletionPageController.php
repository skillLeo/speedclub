<?php

namespace App\Http\Controllers\Web;

use App\Actions\Account\DeleteAccount;
use App\Enums\ErrorCode;
use App\Http\Controllers\Controller;
use App\Http\Requests\Web\DeleteAccountFormRequest;
use App\Models\User;
use App\Services\Auth\PasswordProof;
use App\Services\Auth\SecondFactorGuard;
use App\Services\Auth\TwoFactor;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\MessageBag;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-05 /konto-loeschen (08_LEGAL_COMPLIANCE §6, Google Play's web deletion link). GET without a session (ADR-115). The POST carries
 * the credentials, so it needs no session either: e-mail and password, the second factor when two-factor is on, the confirmation box.
 * Limited per IP (throttle:web-account-deletion) and per account (5 failures an hour), Turnstile when configured. A wrong address and a
 * wrong password read the same, after the same work. The same DeleteAccount as SET-13.
 */
class AccountDeletionPageController extends Controller
{
    public function show(): Response
    {
        return response()->view('public.account-deletion', ['state' => 'form']);
    }

    public function store(DeleteAccountFormRequest $request, PasswordProof $passwords, TwoFactor $twoFactor, SecondFactorGuard $guard, DeleteAccount $action): Response
    {
        $email = $request->email();
        $key = 'web-account-deletion:'.hash('sha256', $email);
        $max = config()->integer('speedclub.account_deletion.web_attempts_per_account');

        if (RateLimiter::tooManyAttempts($key, $max)) {
            return $this->form($email, ['form' => (string) __('public.account_deletion.too_many')], 429);
        }

        $user = User::query()->where('email', $email)->first();
        $code = trim($request->string('code')->toString());

        // A closed account is unknown here as at sign-in: the same answer as a wrong password.
        if (! $passwords->check($user, $request->string('password')->toString()) || $user === null || $user->isPendingDeletion()) {
            RateLimiter::hit($key, 3600);

            return $this->form($email, ['form' => (string) __('public.account_deletion.invalid')], 422);
        }

        if ($user->hasTwoFactor()) {
            if ($user->hasLockedSecondFactor()) {
                return $this->form($email, ['code' => ErrorCode::SecondFactorLocked->message()], 422, needsCode: true);
            }

            if ($code === '') {
                return $this->form($email, ['code' => (string) __('settings.code_required')], 422, needsCode: true);
            }

            // The same per-account budget as the sign-in challenge and the app's re-checks (SecondFactorGuard).
            if (! $twoFactor->verifyEither($user, $code)) {
                RateLimiter::hit($key, 3600);
                $guard->failed($user);

                return $this->form($email, ['code' => (string) __('settings.code_wrong')], 422, needsCode: true);
            }
        }

        RateLimiter::clear($key);
        $action->handle($user);

        return response()->view('public.account-deletion', ['state' => 'done']);
    }

    /**
     * @param  array<string, string>  $errors
     */
    private function form(string $email, array $errors, int $status, bool $needsCode = false): Response
    {
        return response()->view('public.account-deletion', [
            'state' => 'form',
            'errors' => new MessageBag(array_map(fn (string $message): array => [$message], $errors)),
            'old' => ['email' => $email],
            'needsCode' => $needsCode,
        ], $status);
    }
}
