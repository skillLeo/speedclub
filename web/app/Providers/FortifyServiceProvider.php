<?php

namespace App\Providers;

use App\Actions\Fortify\ConfirmStaffTwoFactor;
use App\Actions\Fortify\EnableStaffTwoFactor;
use App\Actions\Fortify\ResetStaffPassword;
use App\Actions\Fortify\UpdateStaffPassword;
use App\Enums\StaffSecurityEvent;
use App\Http\Middleware\EnsureStaffTwoFactor;
use App\Http\Middleware\LimitCsrfCookieRequests;
use App\Http\Middleware\LimitStaffStepInput;
use App\Http\RateLimits;
use App\Http\Responses\Staff\StaffPasswordResetFailed;
use App\Http\Responses\Staff\StaffResetLinkRequested;
use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Audit\StaffTwoFactorAudit;
use App\Services\Auth\LoginThrottle;
use App\Services\Auth\StaffCredentials;
use App\Services\Auth\StaffLoginRateLimiter;
use App\Services\Auth\StaffPasswordCheck;
use App\Services\Auth\TimeboxedPasswordBrokerManager;
use App\Support\ClientAddress;
use Illuminate\Auth\Events\Login;
use Illuminate\Auth\Events\Logout;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Contracts\Auth\CanResetPassword;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Contracts\Http\Kernel as KernelContract;
use Illuminate\Foundation\Http\Kernel;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Cookie;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response as InertiaResponse;
use Laravel\Fortify\Actions\ConfirmTwoFactorAuthentication;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse;
use Laravel\Fortify\Contracts\FailedPasswordResetResponse;
use Laravel\Fortify\Contracts\SuccessfulPasswordResetLinkRequestResponse;
use Laravel\Fortify\Events\RecoveryCodesGenerated;
use Laravel\Fortify\Events\TwoFactorAuthenticationConfirmed;
use Laravel\Fortify\Events\TwoFactorAuthenticationDisabled;
use Laravel\Fortify\Events\TwoFactorAuthenticationFailed;
use Laravel\Fortify\Events\ValidTwoFactorAuthenticationCodeProvided;
use Laravel\Fortify\Fortify;
use Laravel\Fortify\LoginRateLimiter;
use Symfony\Component\HttpFoundation\Response;

/**
 * Staff authentication (guard staff, prefix /admin). Members use their own API controllers (05_ARCHITECTURE §8).
 *
 * The pages ADM-01…04 are Inertia components the admin renders (views on, SEC-P1-30): Auth/Login {status?},
 * Auth/TwoFactorChallenge, Auth/ForgotPassword {status?}, Auth/ResetPassword {token, email} and Auth/ConfirmPassword. The reset
 * page gets token and address from the link's fragment, never from the server (SEC-P1-07), so both props are null.
 */
class FortifyServiceProvider extends ServiceProvider
{
    /**
     * Fortify and Sanctum register these routes without a limiter and have no setting for one (SEC-P1-02, SEC-P1-34).
     */
    private const ROUTE_LIMITERS = [
        'password.email' => 'staff-password-email',
        'password.update' => 'staff-password-reset',
        'two-factor.confirm' => 'staff-two-factor-confirm',
    ];

    /** Lives only from the valid code at the challenge to the sign-in right after it. */
    private const CHALLENGE_PASSED = 'staff.challenge_passed';

    public function register(): void
    {
        // Runs after Fortify's own provider, so these replace its bindings. The controllers pass the broker status in.
        $this->app->bind(SuccessfulPasswordResetLinkRequestResponse::class, StaffResetLinkRequested::class);
        $this->app->bind(FailedPasswordResetLinkRequestResponse::class, StaffResetLinkRequested::class);
        $this->app->bind(FailedPasswordResetResponse::class, StaffPasswordResetFailed::class);

        // Audits enrolment and never replaces confirmed TOTP (SEC-P1-22).
        $this->app->bind(EnableTwoFactorAuthentication::class, EnableStaffTwoFactor::class);

        // Both steps decide on the locked row, so neither can overtake the other (SEC-P1-35).
        $this->app->bind(ConfirmTwoFactorAuthentication::class, ConfirmStaffTwoFactor::class);

        // Hashes the key of Fortify's attempt counter, so no length of address reaches the cache table's key column (SEC-P1-42).
        $this->app->bind(LoginRateLimiter::class, StaffLoginRateLimiter::class);

        // A broker may set its own timebox (config/auth.php, staff: SEC-P1-19). extend(), not singleton(): the framework's
        // provider is deferred and would replace a binding of its own key when it loads.
        $this->app->extend('auth.password', fn (mixed $manager, Application $app): TimeboxedPasswordBrokerManager => new TimeboxedPasswordBrokerManager($app));
    }

    public function boot(): void
    {
        // config/fortify.php lists it after the session and the limiters would run; the limit has to come before both (SEC-P1-43).
        // The csrf-cookie limit has to come before the session as well, or its own 429 would still write a row (SEC-P1-53).
        $this->callAfterResolving(KernelContract::class, function (Kernel $kernel): void {
            $kernel->addToMiddlewarePriorityBefore(StartSession::class, LimitStaffStepInput::class);
            $kernel->addToMiddlewarePriorityBefore(StartSession::class, LimitCsrfCookieRequests::class);
        });

        Fortify::resetUserPasswordsUsing(ResetStaffPassword::class);
        Fortify::updateUserPasswordsUsing(UpdateStaffPassword::class);

        // Wrong passwords of a signed-in session count per account (SEC-P1-26).
        Fortify::confirmPasswordsUsing(fn (Staff $staff, ?string $password): bool => app(StaffPasswordCheck::class)->check($staff, (string) $password));

        $this->registerViews();

        Event::subscribe(StaffTwoFactorAudit::class);
        $this->markSessionsWithoutCode();
        $this->trackSignIns();

        Fortify::authenticateUsing(fn (Request $request): ?Staff => $this->authenticate($request));

        $this->registerLimiters();

        // After every provider has booted, so Fortify's and Sanctum's routes exist. A cached route table already holds the middleware.
        $this->app->booted(function (): void {
            if ($this->app->routesAreCached()) {
                return;
            }

            foreach (Route::getRoutes()->getRoutes() as $route) {
                $name = $route->getName() ?? '';
                $limiter = self::ROUTE_LIMITERS[$name] ?? null;

                if ($limiter !== null) {
                    $route->middleware('throttle:'.$limiter);
                }

                if ($name === 'sanctum.csrf-cookie') {
                    $route->middleware(LimitCsrfCookieRequests::class);
                }
            }
        });

        // Token and address in the fragment, which never reaches a server or an access log (SEC-P1-07). From config, not url(): the
        // link must never follow the Host header of the request that asked for it; on ADMIN_DOMAIN when the admin lives there.
        ResetPassword::createUrlUsing(fn (CanResetPassword $notifiable, string $token): string => self::adminBaseUrl()
            .'/admin/reset#'.http_build_query(['token' => $token, 'email' => $notifiable->getEmailForPasswordReset()], '', '&', PHP_QUERY_RFC3986));
    }

    public static function adminBaseUrl(): string
    {
        $base = rtrim(config()->string('app.url'), '/');
        $domain = config('speedclub.staff.domain');

        if (! is_string($domain) || $domain === '') {
            return $base;
        }

        return (parse_url($base, PHP_URL_SCHEME) ?: 'https').'://'.$domain;
    }

    private function registerViews(): void
    {
        $status = fn (Request $request): ?string => is_string($value = $request->session()->get('status')) ? $value : null;

        Fortify::loginView(fn (Request $request): InertiaResponse => Inertia::render('Auth/Login', ['status' => $status($request)]));
        Fortify::twoFactorChallengeView(fn (): InertiaResponse => Inertia::render('Auth/TwoFactorChallenge'));
        Fortify::requestPasswordResetLinkView(fn (Request $request): InertiaResponse => Inertia::render('Auth/ForgotPassword', ['status' => $status($request)]));
        // The page reads #token=…&email=… from its own URL (SEC-P1-07).
        Fortify::resetPasswordView(fn (): InertiaResponse => Inertia::render('Auth/ResetPassword', ['token' => null, 'email' => null]));
        Fortify::confirmPasswordView(fn (): InertiaResponse => Inertia::render('Auth/ConfirmPassword'));
    }

    /**
     * The password step of the sign-in (SEC-P1-03). The same work whether or not the address belongs to staff: a dummy hash for an
     * unknown one. A delay that grows per address after five failures (LoginThrottle, the member rule), unknown addresses alike, so
     * the delay says nothing either. A suspended account answers like a wrong password. An account whose password nobody proved by
     * e-mail cannot sign in (SEC-P1-20). Fortify calls this twice for a successful sign-in without TOTP.
     */
    private function authenticate(Request $request): ?Staff
    {
        // Staff stay on the 30-minute session (06_ADMIN_SPEC §1, SEC-P1-24): Fortify reads this after the callback, for the
        // sign-in and for the TOTP challenge that follows it.
        $request->merge(['remember' => false]);

        $email = Str::lower($request->string('email')->value());
        $subject = 'staff|'.Str::transliterate($email);
        $throttle = app(LoginThrottle::class);
        $wait = $throttle->secondsUntilAllowed($subject);

        if ($wait > 0) {
            throw ValidationException::withMessages(['email' => [(string) __('auth.throttle', ['seconds' => $wait])]])->status(429);
        }

        $staff = Staff::query()->where('email', $email)->first();
        $valid = Hash::check($request->string('password')->value(), $staff === null ? $this->dummyHash() : $staff->password);

        if ($staff === null || ! $valid || ! $staff->isActive()) {
            $throttle->recordFailure($subject);

            if ($staff !== null) {
                Audit::record(StaffSecurityEvent::SignInFailed->value, $staff, after: ['reason' => $valid ? 'inactive' : 'password'], actor: $staff);
            }

            return null;
        }

        if ($staff->password_proof_required) {
            throw ValidationException::withMessages(['email' => [(string) __('staff_auth.password_proof_required')]]);
        }

        $throttle->clear($subject);

        return $staff;
    }

    /**
     * A hash with the current settings, kept in the cache like the members' (PasswordProof): making it per request would double the
     * work of this path and so tell again.
     */
    private function dummyHash(): string
    {
        $settings = hash('sha256', (string) json_encode(config('hashing')));

        return Cache::rememberForever('auth-dummy-hash:'.$settings, fn (): string => Hash::make(Str::random(40)));
    }

    private function registerLimiters(): void
    {
        // The limiter runs before validation: a non-string address counts under one shared key, RejectNonStringCredentials answers 422.
        // The second limit is per client: a new address each time would never reach the first, and each failed form is a session row
        // (SEC-P1-47). IPv6 clients count by their /64.
        RateLimiter::for('login', function (Request $request): array {
            $email = $request->input('email');
            $client = ClientAddress::key($request);

            return [
                Limit::perMinute(5)->by(Str::transliterate((is_string($email) ? Str::lower($email) : '').'|'.$client)),
                Limit::perMinute(30)->by('staff-login-client|'.$client),
            ];
        });

        RateLimiter::for('two-factor', fn (Request $request): Limit => Limit::perMinute(5)->by(
            (string) $request->session()->get('login.id')
        ));

        // Guesses at the current code from a signed-in session, per account (SEC-P1-34).
        RateLimiter::for('staff-two-factor-confirm', fn (Request $request): Limit => Limit::perMinute(config()->integer('speedclub.staff.two_factor_confirm_per_minute'))
            ->by('staff-two-factor-confirm|'.(string) $request->user('staff')?->getAuthIdentifier()));

        // Per IP only. The per-address bound counts links really sent (Staff::sendPasswordResetNotification, SEC-P1-21). A throttled
        // link request gets the neutral answer, so the limiter tells nothing either.
        RateLimiter::for('staff-password-email', fn (Request $request): array => array_map(
            fn (Limit $limit): Limit => $limit->response(fn (Request $request): Response => (new StaffResetLinkRequested)->toResponse($request)),
            $this->resetLimits('staff-password-email', $request, perAddress: false),
        ));

        RateLimiter::for('staff-password-reset', fn (Request $request): array => array_map(
            fn (Limit $limit): Limit => $limit->response(function (Request $request, array $headers): Response {
                /** @var array<string, int|string> $headers */
                $tooMany = RateLimits::tooMany('staff_password_reset', $headers);

                return $request->wantsJson()
                    ? new JsonResponse(['message' => $tooMany->getMessage(), 'code' => $tooMany->errorCode->value, 'errors' => (object) []], 429, $tooMany->headers)
                    // No withInput(): the address is the sender's own, and storing it would write up to 16 KB per request past the limit (SEC-P1-47).
                    : back()->withErrors(['email' => $tooMany->getMessage()]);
            }),
            $this->resetLimits('staff-password-reset', $request, perAddress: true),
        ));
    }

    /**
     * Which sessions showed a code, for EnsureStaffTwoFactor (SEC-P1-32). Every staff sign-in counts as "no code" unless the
     * challenge passed just before it. Not by asking the account: Fortify loads it again between its check for the challenge
     * and the sign-in, so a confirmation in between would look like a proven sign-in.
     */
    private function markSessionsWithoutCode(): void
    {
        Event::listen(ValidTwoFactorAuthenticationCodeProvided::class, function (): void {
            session()->put(self::CHALLENGE_PASSED, true);
        });

        Event::listen(Login::class, function (Login $event): void {
            if (! $event->user instanceof Staff) {
                return;
            }

            if (session()->pull(self::CHALLENGE_PASSED) === true) {
                session()->forget(EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE);
            } else {
                session()->put(EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE, true);
            }
        });

        // The session that confirms has just shown a valid code, so it stays. Only once that counts: ConfirmStaffTwoFactor runs in a
        // transaction, and a rollback must leave the mark.
        Event::listen(TwoFactorAuthenticationConfirmed::class, function (): void {
            DB::afterCommit(fn () => session()->forget(EnsureStaffTwoFactor::SIGNED_IN_WITHOUT_CODE));
        });
    }

    /**
     * SEC-P1-03 and SEC-P1-25: sign-in, sign-out and a failed second factor into the audit log; the session keeps the credentials epoch
     * it signed in with; a removed key or new recovery codes end every other session. The marker cookie lets a request after the
     * 30-minute idle limit tell "expired" from "never signed in" (ADR-217).
     */
    private function trackSignIns(): void
    {
        Event::listen(Login::class, function (Login $event): void {
            if (! $event->user instanceof Staff) {
                return;
            }

            $staff = $event->user;
            StaffCredentials::remember($staff, session()->driver());
            Staff::query()->whereKey($staff->getKey())->toBase()->update(['last_login_at' => now()]);

            Cookie::queue(Cookie::make(
                config()->string('speedclub.staff.seen_cookie'),
                '1',
                config()->integer('speedclub.staff.seen_cookie_minutes'),
                config()->string('speedclub.staff.session_path'),
                httpOnly: true,
                sameSite: 'lax',
            ));

            Audit::record(StaffSecurityEvent::SignedIn->value, $staff, after: ['remembered' => $event->remember], actor: $staff);
        });

        Event::listen(Logout::class, function (Logout $event): void {
            if (! $event->user instanceof Staff) {
                return;
            }

            Cookie::queue(Cookie::forget(config()->string('speedclub.staff.seen_cookie'), config()->string('speedclub.staff.session_path')));
            Audit::record(StaffSecurityEvent::SignedOut->value, $event->user, actor: $event->user);
        });

        Event::listen(TwoFactorAuthenticationFailed::class, function (TwoFactorAuthenticationFailed $event): void {
            if (($staff = self::staffOf($event)) !== null) {
                Audit::record(StaffSecurityEvent::TwoFactorFailed->value, $staff, actor: $staff);
            }
        });

        foreach ([TwoFactorAuthenticationDisabled::class, RecoveryCodesGenerated::class] as $changed) {
            Event::listen($changed, function (TwoFactorAuthenticationDisabled|RecoveryCodesGenerated $event): void {
                if (($staff = self::staffOf($event)) !== null) {
                    StaffCredentials::rotate($staff, session()->driver());
                }
            });
        }
    }

    /**
     * Fortify's events declare App\Models\User; for staff they carry a Staff.
     */
    private static function staffOf(object $event): ?Staff
    {
        $user = property_exists($event, 'user') ? $event->user : null;

        return $user instanceof Staff ? $user : null;
    }

    /**
     * @return list<Limit>
     */
    private function resetLimits(string $name, Request $request, bool $perAddress): array
    {
        $max = config()->integer('speedclub.rate_limits.staff_password_reset.max');
        $seconds = config()->integer('speedclub.rate_limits.staff_password_reset.minutes') * 60;
        $limits = [(new Limit('', $max, $seconds))->by($name.'|ip:'.ClientAddress::key($request))];

        if ($perAddress) {
            // The limiter runs before validation: a non-string address counts under one shared key instead of failing. Accent variants
            // reach the same row (utf8mb4_unicode_ci), so they share a key too (SEC-P1-29).
            $email = $request->input('email');
            $email = is_string($email) ? Str::transliterate(Str::lower(trim($email))) : '';
            $limits[] = (new Limit('', $max, $seconds))->by($name.'|email:'.hash('sha256', $email));
        }

        return $limits;
    }
}
