<?php

namespace App\Http\Middleware;

use App\Http\Controllers\Admin\Errors\AdminErrorPage;
use App\Http\Controllers\Admin\Support\AdminLocale;
use App\Http\Controllers\Admin\Support\StaffCounts;
use App\Models\Staff;
use App\Services\Memberships\Memberships;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Inertia\Middleware;
use Symfony\Component\HttpFoundation\Response;

/**
 * Shared props of the admin portal (m3.1 contract §3) and the admin error pages (ADM-05) for errors raised inside an admin route.
 * Errors raised before the route runs (unknown URL, CSRF, maintenance) reach AdminErrorPage through bootstrap/app.php.
 */
class HandleInertiaRequests extends Middleware
{
    /**
     * @var string
     */
    protected $rootView = 'app';

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        AdminLocale::apply($request);

        return parent::handle($request, fn (Request $request): Response => AdminErrorPage::transform($request, $next($request)));
    }

    /**
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        $user = $request->user('staff');
        $staff = $user instanceof Staff ? $user : null;
        $session = $request->hasSession() ? $request->session() : null;

        return [
            ...parent::share($request),
            'staff' => fn (): ?array => $staff === null ? null : [
                ...self::staff($staff, $session?->get('auth.password_confirmed_at')),
                // ADM-03 skipped for this session (STAFF_2FA_REQUIRED=false): every admin page shows the reminder banner.
                'two_factor_skipped' => EnsureStaffTwoFactor::skippedBy($request, $staff),
            ],
            'app' => fn (): array => [
                'env' => app()->environment(),
                'version' => substr((string) $this->version($request), 0, 8) ?: null,
                'locale' => app()->getLocale(),
                'idle_minutes' => config()->integer('speedclub.staff.session_lifetime'),
                'warn_minutes' => max(1, config()->integer('speedclub.staff.session_lifetime') - 5),
            ],
            'flash' => fn (): array => $session === null ? [] : array_filter([
                'success' => $session->get('success'),
                'error' => $session->get('error'),
                'approval' => $session->get('approval'),
                'confirm_password' => $session->get('confirm_password') === true ? true : null,
                'session_expired' => $session->get('session_expired') === true ? true : null,
            ], fn (mixed $value): bool => $value !== null),
            // The sidebar badges. Not `counts`: ten pages pass a `counts` of their own, which replaced this one and hid the badges (DQ-708).
            'nav_counts' => fn (): array => StaffCounts::for($staff),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function staff(Staff $staff, mixed $confirmedAt): array
    {
        $confirmedUntil = is_numeric($confirmedAt)
            ? Carbon::createFromTimestamp((int) $confirmedAt + config()->integer('speedclub.staff.recent_password_seconds', 300))
            : null;

        return [
            'id' => $staff->id,
            'name' => $staff->name,
            'email' => $staff->email,
            'roles' => $staff->getRoleNames()->values()->all(),
            // ADM-F1/F2: while premium.enabled is off the memberships routes answer 404, so the atom is not offered to the UI (nav hidden).
            'permissions' => $staff->getAllPermissions()->pluck('name')
                ->reject(fn (mixed $atom): bool => $atom === 'memberships.manage' && ! app(Memberships::class)->enabled())
                ->values()->all(),
            'two_factor_confirmed' => $staff->hasEnabledTwoFactorAuthentication(),
            'password_confirmed_until' => $confirmedUntil?->isFuture() === true ? $confirmedUntil->toIso8601String() : null,
        ];
    }
}
