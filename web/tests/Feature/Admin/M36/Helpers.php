<?php

use App\Models\ApprovalRequest;
use App\Models\FeatureFlag;
use App\Models\Staff;
use Illuminate\Testing\TestResponse;
use Laravel\Fortify\Fortify;
use PragmaRX\Google2FA\Google2FA;
use Spatie\Permission\Models\Role;

require_once __DIR__.'/../M32/Helpers.php';

/**
 * M3.6 admin HTTP tests (lane a, owned by the admin team): the pages and controllers of ADM-39…52 and F1/F2 over the Team, privacy,
 * system, account, settings and memberships Actions. Functions are prefixed adm36 (the backend team's lane-a suites use m36).
 */
const ADM36_OWNER_ADMIN = ['owner', 'admin'];
const ADM36_PRIVACY_VIEW = ['owner', 'admin', 'support'];
const ADM36_EVERYONE = ['owner', 'admin', 'moderator', 'support', 'content_editor', 'analyst'];

function adm36Reason(): string
{
    return 'Neue Aufgabenverteilung im Team ab Montag.';
}

/** Staff of a role, signed in, with a password confirmed just now (ADR-215); the roles of the StaffSeeder first. */
function adm36As(string $role): Staff
{
    return adm32SignedIn($role);
}

/** Staff of a role (not signed in), the roles seeded first (once: the seeder would also bring back its configured Owner). */
function adm36Staff(string $role, array $attributes = []): Staff
{
    if (! Role::query()->where('guard_name', 'staff')->exists()) {
        seedStaffRoles();
    }

    $staff = staffWithRole($role);

    if ($attributes !== []) {
        $staff->forceFill($attributes)->save();
    }

    return $staff->fresh() ?? $staff;
}

/** Signed in as $staff with a fresh password confirmation. */
function adm36SignIn(Staff $staff): Staff
{
    app('auth')->forgetGuards();
    actingAsStaff($staff);
    test()->withSession(['auth.password_confirmed_at' => time()]);

    return $staff;
}

/** The session holds a password confirmation older than 5 minutes. */
function adm36StalePassword(): void
{
    test()->withSession(['auth.password_confirmed_at' => time() - 3600]);
}

/** @return list<string> */
function adm36Roles(Staff $staff): array
{
    return $staff->fresh()?->roles()->pluck('name')->sort()->values()->all() ?? [];
}

function adm36Pending(string $action): ?ApprovalRequest
{
    return ApprovalRequest::query()->where('action', $action)->where('status', 'pending')->latest()->first();
}

function adm36Premium(bool $on = true): void
{
    FeatureFlag::query()->updateOrCreate(['key' => 'premium.enabled'], ['enabled' => $on]);
}

function adm36Code(Staff $staff): string
{
    $secret = (string) Fortify::currentEncrypter()->decrypt((string) $staff->fresh()?->two_factor_secret);

    return app(Google2FA::class)->getCurrentOtp($secret);
}

/** Every string anywhere in the Inertia props of a response. */
function adm36PropsJson(TestResponse $response): string
{
    $page = $response->viewData('page');

    return json_encode(is_array($page) ? $page['props'] : [], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: '';
}
