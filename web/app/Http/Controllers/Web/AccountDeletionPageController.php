<?php

namespace App\Http\Controllers\Web;

use App\Actions\Account\DeleteAccount;
use App\Actions\Account\ProveDeletionByEmailCode;
use App\Actions\Account\StartAccountDeletionCode;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Exceptions\SecondFactorRefused;
use App\Http\Controllers\Controller;
use App\Http\Requests\Web\DeleteAccountFormRequest;
use App\Http\Requests\Web\RequestDeletionCodeFormRequest;
use App\Models\User;
use App\Services\Auth\PasswordProof;
use App\Services\Auth\SecondFactorGuard;
use App\Services\Auth\TwoFactor;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\MessageBag;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-05 /konto-loeschen (08_LEGAL_COMPLIANCE §6, Google Play's web deletion link). GET without a session (ADR-115). The POST carries
 * the credentials, so it needs no session either: e-mail and password, the second factor when two-factor is on, the confirmation box.
 * Limited per IP (throttle:web-account-deletion) and per account (5 failures an hour), Turnstile when configured. A wrong address and a
 * wrong password read the same, after the same work. The same DeleteAccount as SET-13.
 *
 * Client round 6 (L3): an account without a password (Auth 2.0) proves the mailbox instead. ?methode=code shows the request step,
 * POST /konto-loeschen/code mails a deletion code (StartAccountDeletionCode) and renders the code step, whose hidden attempt id binds the
 * code to this page; the POST then spends it (ProveDeletionByEmailCode) and closes the account the same way.
 */
class AccountDeletionPageController extends Controller
{
    public function show(Request $request): Response
    {
        return response()->view('public.account-deletion', ['state' => 'form', 'mode' => $request->query('methode') === 'code' ? 'request' : 'password']);
    }

    public function requestCode(RequestDeletionCodeFormRequest $request, StartAccountDeletionCode $action): Response
    {
        $email = $request->email();
        $attempt = Str::random(43);
        $wait = $action->handle($email, $attempt, app()->getLocale());

        // Cooldown, hourly limit or lock: nothing went out. The same answer for every address, account or not.
        if ($wait > 0) {
            $minutes = max(1, (int) ceil($wait / 60));
            $time = $wait < 60 ? trans_choice('rate_limits.time.seconds', $wait, ['count' => $wait]) : trans_choice('rate_limits.time.minutes', $minutes, ['count' => $minutes]);

            return $this->form($email, ['form' => (string) __('public.account_deletion.code_wait', ['time' => $time])], 429, mode: 'request', headers: ['Retry-After' => (string) $wait]);
        }

        return response()->view('public.account-deletion', ['state' => 'form', 'mode' => 'code', 'attempt' => $attempt, 'codeSent' => true, 'old' => ['email' => $email]]);
    }

    public function store(DeleteAccountFormRequest $request, PasswordProof $passwords, TwoFactor $twoFactor, SecondFactorGuard $guard, DeleteAccount $action, ProveDeletionByEmailCode $byEmail): Response
    {
        $email = $request->email();
        $key = 'web-account-deletion:'.hash('sha256', $email);
        $max = config()->integer('speedclub.account_deletion.web_attempts_per_account');
        $attempt = $request->attempt();
        $mode = $request->usesEmailCode() ? 'code' : 'password';

        if (RateLimiter::tooManyAttempts($key, $max)) {
            return $this->form($email, ['form' => (string) __('public.account_deletion.too_many')], 429, mode: $mode, attempt: $attempt);
        }

        $code = trim($request->string('code')->toString());

        if ($request->usesEmailCode()) {
            return $this->storeWithEmailCode($request, $byEmail, $action, $email, $attempt, $code, $key);
        }

        $user = User::query()->where('email', $email)->first();

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

    private function storeWithEmailCode(DeleteAccountFormRequest $request, ProveDeletionByEmailCode $byEmail, DeleteAccount $action, string $email, string $attempt, string $code, string $key): Response
    {
        try {
            $user = $byEmail->handle($email, $attempt, $request->string('email_code')->toString(), $code);
        } catch (SecondFactorRefused $refused) {
            if ($refused->reason === SecondFactorRefused::WRONG) {
                RateLimiter::hit($key, 3600);
            }

            $message = match ($refused->reason) {
                SecondFactorRefused::LOCKED => ErrorCode::SecondFactorLocked->message(),
                SecondFactorRefused::REQUIRED => (string) __('settings.code_required'),
                default => (string) __('settings.code_wrong'),
            };

            return $this->form($email, ['code' => $message], 422, needsCode: true, mode: 'code', attempt: $attempt);
        } catch (ApiException $refused) {
            // A lock shuts this client out of the address for a while: back to the request step, which says how long.
            if ($refused->errorCode === ErrorCode::EmailCodeLocked) {
                return $this->form($email, ['form' => $refused->getMessage()], 429, mode: 'request', headers: $refused->headers);
            }

            $message = $refused->errorCode === ErrorCode::CodeExpired ? ErrorCode::CodeExpired->message() : $refused->getMessage();

            return $this->form($email, ['email_code' => $message], 422, mode: 'code', attempt: $attempt);
        }

        RateLimiter::clear($key);
        $action->handle($user);

        return response()->view('public.account-deletion', ['state' => 'done']);
    }

    /**
     * @param  array<string, string>  $errors
     * @param  'password'|'request'|'code'  $mode
     * @param  array<string, string>  $headers
     */
    private function form(string $email, array $errors, int $status, bool $needsCode = false, string $mode = 'password', string $attempt = '', array $headers = []): Response
    {
        return response()->view('public.account-deletion', [
            'state' => 'form',
            'mode' => $mode,
            'attempt' => $attempt,
            'errors' => new MessageBag(array_map(fn (string $message): array => [$message], $errors)),
            'old' => ['email' => $email],
            'needsCode' => $needsCode,
        ], $status, $headers);
    }
}
