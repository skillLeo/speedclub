<?php

use Illuminate\Http\Request;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Inertia\DevTools\DevTools;
use Inertia\DevTools\Http\Authorize;

/**
 * Phase 1 security review (docs/reports/security/phase-1.md). The module tests check their own routes; these check the whole
 * route table, so a route added later without its guard, limiter or classification fails here.
 */

/**
 * Anonymous API routes, on purpose. Anything else under api/ must need a member.
 *
 * @return list<string>
 */
function p1PublicApi(): array
{
    return [
        'api.v1.app-config',
        // M4.11 Social 2.0: VEH-05, the Highlights rail and [build_comments] reads, guests included like the vehicle page.
        'api.v1.build-updates.show',
        'api.v1.vehicles.highlights.index',
        'api.v1.comments.index',
        // M4.12 events (09 §8.7): list, map pins, detail and the calendar file read by guests too, behind browse and the events flag.
        'api.v1.events.index',
        'api.v1.events.pins',
        'api.v1.events.show',
        'api.v1.events.ics',
        // M4.6 Auth 2.0 (09 §8.1, §8.2): the passwordless ways in, each behind its own limiter.
        'api.v1.auth.apple',
        'api.v1.auth.email.resend',
        'api.v1.auth.email.start',
        'api.v1.auth.email.verify',
        'api.v1.auth.google',
        'api.v1.auth.link.confirm',
        'api.v1.auth.login',
        // SEC-M46-05: the nonce of an Apple or Google sign-in, before any account is known (throttle:auth-social).
        'api.v1.auth.nonce',
        'api.v1.auth.passkeys.options',
        'api.v1.auth.passkeys.verify',
        'api.v1.auth.password.forgot',
        'api.v1.auth.password.reset',
        'api.v1.auth.register',
        // M4.7 (09 §8.4): "Das war ich nicht" from a login alert; the token is the credential (throttle:auth-secure-account).
        'api.v1.auth.secure-account',
        'api.v1.auth.two-factor.challenge',
        'api.v1.catalog.brands',
        // M2.4 review #5: a chat photo by signed URL (signed + viewer re-check), like the data export download.
        'api.v1.chat-media.show',
        // M4.13: a service log photo by signed URL (signed + owner re-check), like chat media.
        'api.v1.maintenance-media.show',
        // Crash reports of the app's error screens: an error can happen signed out too (per-IP limit, no personal data).
        'api.v1.client-errors.store',
        'api.v1.catalog.generations',
        'api.v1.catalog.makes',
        'api.v1.catalog.mod-categories',
        'api.v1.catalog.models',
        'api.v1.discover',
        'api.v1.discover.makes.show',
        'api.v1.discover.models.builds',
        'api.v1.discover.models.show',
        'api.v1.discover.models.wheel-setups',
        'api.v1.feed',
        'api.v1.home.featured',
        'api.v1.home.modules',
        'api.v1.help.index',
        'api.v1.help.show',
        'api.v1.home.new-builds',
        'api.v1.legal.index',
        'api.v1.legal.show',
        // Phase 4 lane B: SET-25 "Was ist neu" (a data file of the release, throttle:public-read).
        'api.v1.release-notes.index',
        'api.v1.me.exports.download',
        'api.v1.public.users.followers',
        'api.v1.public.users.following',
        'api.v1.public.users.show',
        'api.v1.public.users.vehicles',
        // Phase 4 lane B: PROF-01/02 "Updates" and "Treffen", by the profile's own rules (the events list also behind the events flag).
        'api.v1.public.users.updates',
        'api.v1.public.users.events',
        'api.v1.public.vehicles.mods.show',
        'api.v1.public.vehicles.show',
        'api.v1.public.vehicles.updates.index',
        'api.v1.public.vehicles.updates.show',
        'api.v1.qr.resolve',
        'api.v1.search',
        'api.v1.search.facets',
        'api.v1.search.interpret',
        'api.v1.search.users',
        'api.v1.search.vehicles',
        'api.v1.usernames.check',
        'api.v1.vehicles.similar',
        // M2.7 [SIG]: VEH-06 and VEH-07 read only what the viewer may see on the vehicle page (ADR-124).
        'api.v1.compare',
        'api.v1.vehicles.share-card',
    ];
}

/**
 * Member writes without a limiter of their own, and why that is fine.
 *
 * @return array<string, string>
 */
function p1UnthrottledWrites(): array
{
    return [
        'api.v1.auth.logout' => 'ends the session it is sent with',
    ];
}

/**
 * Open findings of the Phase 1 review. Each entry must still be a gap: once a limiter is added, a test below fails until the
 * entry goes, so this list can only shrink.
 *
 * @return array<string, string>
 */
function p1KnownUnthrottled(): array
{
    // SEC-P1-04 closed in M2.2: PATCH me/profile and me/settings share throttle:account-edits.
    return [];
}

/**
 * Staff routes a signed-out browser may call. Everything else under admin/ needs the staff guard.
 *
 * @return list<string>
 */
function p1GuestAdmin(): array
{
    // M3.1: Fortify's own pages (views on) for the sign-in, the challenge and the reset. DQ-507: the admin group's fallback answers every
    // unknown /admin URL with a 404 (in the shell for signed-in staff, the minimal page for a guest, SEC-P3-04); it does nothing else.
    // M3.6 (ADR-237): the invite page, where an invited person sets the password with the single-use token from the mail (10 a minute).
    return ['login', 'login.store', 'password.request', 'password.reset', 'password.email', 'password.update', 'two-factor.login', 'two-factor.login.store', 'admin.fallback', 'admin.invite', 'admin.invite.store'];
}

/**
 * @return list<LaravelRoute>
 */
function p1Routes(string $prefix): array
{
    return array_values(array_filter(
        Route::getRoutes()->getRoutes(),
        fn (LaravelRoute $route): bool => $route->uri() === $prefix || str_starts_with($route->uri(), $prefix.'/'),
    ));
}

/**
 * @return list<string>
 */
function p1Middleware(LaravelRoute $route): array
{
    return array_values(array_filter($route->gatherMiddleware(), is_string(...)));
}

function p1Throttled(LaravelRoute $route): bool
{
    return array_filter(p1Middleware($route), fn (string $name): bool => str_starts_with($name, 'throttle:')) !== [];
}

function p1IsWrite(LaravelRoute $route): bool
{
    return array_diff($route->methods(), ['GET', 'HEAD']) !== [];
}

describe('API route table', function () {
    it('needs a member on every route that is not listed as public', function () {
        $routes = p1Routes('api');
        $open = [];

        foreach ($routes as $route) {
            $middleware = p1Middleware($route);
            $member = in_array('member', $middleware, true) || in_array('auth:sanctum', $middleware, true);

            if (! $member && ! in_array($route->getName(), p1PublicApi(), true)) {
                $open[] = implode('|', $route->methods()).' '.$route->uri();
            }
        }

        expect(count($routes))->toBeGreaterThan(70)->and($open)->toBe([]);
    });

    it('lists only routes that exist and really are public, each behind a limiter', function () {
        foreach (p1PublicApi() as $name) {
            $route = Route::getRoutes()->getByName($name);

            expect($route)->not->toBeNull("$name is gone");
            expect(p1Middleware($route))->not->toContain('member')->not->toContain('auth:sanctum');
            expect(p1Throttled($route))->toBeTrue("$name has no throttle");
        }
    });

    it('throttles every member write, apart from the listed ones', function () {
        $missing = [];

        foreach (p1Routes('api') as $route) {
            $name = (string) $route->getName();

            if (p1IsWrite($route) && ! p1Throttled($route) && ! isset(p1UnthrottledWrites()[$name]) && ! isset(p1KnownUnthrottled()[$name])) {
                $missing[] = $name;
            }
        }

        expect($missing)->toBe([]);
    });

    it('keeps the list of open gaps honest', function () {
        // Empty since SEC-P1-04 closed (M2.2); a new gap must name its finding.
        expect(p1KnownUnthrottled())->toBeArray()->each->toStartWith('SEC-');

        foreach (p1KnownUnthrottled() as $name => $finding) {
            $route = Route::getRoutes()->getByName($name);

            expect($route)->not->toBeNull("$name is gone: remove it from the list ($finding)");
            expect(p1Throttled($route))->toBeFalse("$name is throttled now: remove it from the list and close $finding");
        }
    });

    it('answers 401 to a guest on every member route, before any lookup', function () {
        $checked = 0;

        foreach (p1Routes('api') as $route) {
            if (in_array($route->getName(), p1PublicApi(), true)) {
                continue;
            }

            $uri = '/'.preg_replace('/\{[^}]+\}/', '01JAAAAAAAAAAAAAAAAAAAAAAA', $route->uri());

            $this->json($route->methods()[0], $uri)->assertUnauthorized();
            $checked++;
        }

        expect($checked)->toBeGreaterThan(40);
    });
});

describe('admin route table', function () {
    it('needs the staff guard everywhere but the sign-in and reset steps', function () {
        $open = [];

        foreach (p1Routes('admin') as $route) {
            $middleware = p1Middleware($route);

            expect($middleware)->toContain('staff');

            if (! in_array('auth:staff', $middleware, true) && ! in_array($route->getName(), p1GuestAdmin(), true)) {
                $open[] = implode('|', $route->methods()).' '.$route->uri();
            }
        }

        expect($open)->toBe([]);
    });

    it('limits the guest steps that check a password or a code', function (string $name) {
        expect(p1Throttled(Route::getRoutes()->getByName($name)))->toBeTrue();
    })->with(['login.store', 'two-factor.login.store', 'password.email', 'password.update']);

    it('asks for the password again before any two-factor change', function (string $name) {
        expect(p1Middleware(Route::getRoutes()->getByName($name)))->toContain('auth:staff', 'password.confirm');
    })->with([
        'two-factor.enable', 'two-factor.confirm', 'two-factor.disable', 'two-factor.qr-code', 'two-factor.secret-key',
        'two-factor.recovery-codes', 'two-factor.regenerate-recovery-codes',
    ]);
});

describe('developer tools outside local', function () {
    it('closes the Inertia devtools entries', function (string $environment) {
        app()->detectEnvironment(fn (): string => $environment);
        config(['inertia.devtools.enabled' => null, 'inertia.devtools.gate' => null]);

        $answer = (new Authorize)->handle(Request::create('/_inertia/devtools/entries'), fn () => response('open'));

        // Not even registered: the provider adds the routes only when enabled() holds at boot.
        expect(DevTools::enabled())->toBeFalse()->and($answer->getStatusCode())->toBe(403);
        $this->getJson('/_inertia/devtools/entries')->assertNotFound();
    })->with(['staging', 'production']);

    it('shows the API docs only on local and staging hosts', function (string $environment, bool $allowed) {
        app()->detectEnvironment(fn (): string => $environment);

        expect(Gate::allows('viewApiDocs'))->toBe($allowed);
    })->with([
        'local' => ['local', true],
        'staging' => ['staging', true],
        'production' => ['production', false],
        'unknown' => ['prod', false],
    ]);

    it('keeps the dev packages out of a production install', function () {
        /** @var array{require: array<string, string>, 'require-dev': array<string, string>} $composer */
        $composer = json_decode((string) file_get_contents(base_path('composer.json')), true, flags: JSON_THROW_ON_ERROR);

        expect(array_keys($composer['require']))->not->toContain('laravel/pail', 'fakerphp/faker')
            ->and(array_keys($composer['require-dev']))->toContain('fakerphp/faker', 'laravel/pail');
    });

    it('offers the mail preview only to local and testing', function () {
        expect(config('speedclub.dev_mail.environments'))->toBe(['local', 'testing']);
    });
});

describe('storage and data minimisation', function () {
    it('keeps photo originals on a disk the web server does not serve', function () {
        $disk = config()->string('speedclub.media.private_disk');
        $root = str_replace('\\', '/', (string) config("filesystems.disks.$disk.root"));

        expect(config("filesystems.disks.$disk.driver"))->toBe('local')
            ->and(config("filesystems.disks.$disk.serve"))->toBeFalse()
            ->and(config("filesystems.disks.$disk.url"))->toBeNull()
            ->and($root)->not->toStartWith(str_replace('\\', '/', public_path()))
            ->and($root)->not->toStartWith(str_replace('\\', '/', storage_path('app/public')));
    });

    it('stores network identifiers only for sessions and staff access', function () {
        $found = [];
        $database = DB::connection()->getDatabaseName();

        foreach (Schema::getTableListing($database, false) as $table) {
            foreach (Schema::getColumnListing($table) as $column) {
                if (preg_match('/(^|_)(ip|ip_address|user_agent|latitude|longitude|lat|lng)$/', $column) === 1) {
                    $found[] = "$table.$column";
                }
            }
        }

        sort($found);

        // M4.12: the coordinates of an event's venue and its coarse area point (09 §8.7, §11), a place an organiser publishes, never a
        // member's position (device location is used per request only and never stored). Phase 4 lane B: the SET-11 home region, a city
        // the member picks, stored snapped to the 0.05° grid and shown to nobody else (not a device position either).
        expect($found)->toBe(['audit_event_access.ip', 'audit_event_access.user_agent', 'events.area_lat', 'events.area_lng', 'events.lat', 'events.lng', 'sessions.ip_address', 'sessions.user_agent', 'users.home_region_lat', 'users.home_region_lng']);
    });

    it('counts QR scans per code and day, nothing about the scanner', function () {
        expect(Schema::getColumnListing('qr_scan_daily'))->toEqualCanonicalizing(['id', 'qr_code_id', 'day', 'count']);
    });
});
