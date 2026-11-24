<?php

use App\Models\Staff;
use App\Services\Setup\SetupToken;
use App\Services\Setup\WebSetup;
use App\Support\ClientAddress;
use Database\Seeders\StaffSeeder;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiter;
use Illuminate\Contracts\Encryption\Encrypter;
use Illuminate\Contracts\Routing\ResponseFactory;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\Route;

/*
 * ADR-539: /internal/setup/{token} and /internal/maintenance/{token}/on|off, the web installer of a host without SSH (ALL-INKL
 * Private). Artisan is faked: the commands are recorded, never run (a real config/route cache here would outlive the test).
 */

const SETUP_TEST_TOKEN = 'd1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2';

/** @return ArrayObject<int, array{0: string, 1: array<string, mixed>}> */
function fakeSetupArtisan(array $exitCodes = [], array $effects = []): ArrayObject
{
    $calls = new ArrayObject;
    Artisan::shouldReceive('call')->andReturnUsing(function (string $command, array $arguments = []) use ($calls, $exitCodes, $effects): int {
        $calls[] = [$command, $arguments];
        if (isset($effects[$command])) {
            $effects[$command]();
        }

        return $exitCodes[$command] ?? 0;
    });
    Artisan::shouldReceive('output')->andReturn("ok\n");

    return $calls;
}

/** @param ArrayObject<int, array{0: string, 1: array<string, mixed>}> $calls */
function setupCommands(ArrayObject $calls): array
{
    return array_map(fn (array $call): string => $call[0].(isset($call[1]['--class']) ? ':'.$call[1]['--class'] : ''), $calls->getArrayCopy());
}

function forgetSpentSetupTokens(): void
{
    @unlink(storage_path(SetupToken::SPENT_FILE));
}

beforeEach(function () {
    // No env file by default: the token comes from the config, as on a host that sets real environment variables.
    $this->originalEnvironmentPath = app()->environmentPath();
    $this->environmentDirectory = sys_get_temp_dir().'/sc-setup-env-'.bin2hex(random_bytes(4));
    mkdir($this->environmentDirectory);
    app()->useEnvironmentPath($this->environmentDirectory);
    config(['speedclub.setup.token' => SETUP_TEST_TOKEN]);
    (new RateLimiter(Cache::store('file')))->clear('setup-url|'.ClientAddress::key(request()));
    forgetSpentSetupTokens();
});

afterEach(function () {
    forgetSpentSetupTokens();
    app()->useEnvironmentPath($this->originalEnvironmentPath);
    array_map(unlink(...), array_filter(glob($this->environmentDirectory.'/{,.}*', GLOB_BRACE | GLOB_NOSORT) ?: [], is_file(...)));
    @rmdir($this->environmentDirectory);
});

it('shows the state and one start button on GET, without a cookie, and runs nothing', function () {
    $calls = fakeSetupArtisan();

    $response = $this->get('/internal/setup/'.SETUP_TEST_TOKEN)
        ->assertOk()
        ->assertSee('SPEED CLUB · Einrichtung')
        ->assertSee('Einrichtung starten')
        ->assertSee('Datenbank: leer');

    expect($response->headers->getCookies())->toBe([])
        ->and($response->headers->get('Cache-Control'))->toContain('no-store')
        ->and($response->headers->get('X-Robots-Tag'))->toContain('noindex')
        ->and($calls->count())->toBe(0);
});

it('is a 404 when no usable token is configured, whatever the URL carries', function (string $configured) {
    config(['speedclub.setup.token' => $configured]);
    $calls = fakeSetupArtisan();

    $this->get('/internal/setup/'.SETUP_TEST_TOKEN)->assertNotFound();
    $this->post('/internal/setup/'.SETUP_TEST_TOKEN)->assertNotFound();
    $this->get('/internal/maintenance/'.SETUP_TEST_TOKEN.'/on')->assertNotFound();

    expect($calls->count())->toBe(0);
})->with(['empty' => '', 'too short' => 'short-token-under-32']);

it('is a 404 for a wrong token and runs nothing', function (string $token) {
    $calls = fakeSetupArtisan();

    $this->post('/internal/setup/'.$token)->assertNotFound();
    $this->get('/internal/maintenance/'.$token.'/on')->assertNotFound();

    expect($calls->count())->toBe(0);
})->with(['wrong' => 'e1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2', 'prefix' => substr(SETUP_TEST_TOKEN, 0, 40), 'longer' => SETUP_TEST_TOKEN.'x']);

it('counts every request per address and answers 429 over the limit, a valid one included', function () {
    config(['speedclub.setup.max_per_minute' => 3]);
    $calls = fakeSetupArtisan();

    foreach (range(1, 3) as $ignored) {
        $this->get('/internal/setup/wrong-token-'.str_repeat('x', 40))->assertNotFound();
    }

    $this->post('/internal/setup/'.SETUP_TEST_TOKEN)->assertStatus(429)->assertHeader('Retry-After');
    $this->get('/internal/maintenance/'.SETUP_TEST_TOKEN.'/on')->assertStatus(429);
    expect($calls->count())->toBe(0);
});

it('runs a first install in order: maintenance, migrate, the full seeder, storage, caches, up, doctor', function () {
    $calls = fakeSetupArtisan();

    $this->post('/internal/setup/'.SETUP_TEST_TOKEN)->assertOk()->assertSee('Fertig')->assertSee('Grunddaten');

    $commands = array_values(array_diff(setupCommands($calls), ['storage:link']));
    expect($commands)->toBe(['down', 'migrate', 'db:seed', 'speedclub:releases-sync', 'optimize:clear', 'optimize', 'up', 'speedclub:doctor'])
        ->and($calls[2][1])->toBe(['--force' => true])
        ->and(setupCommands($calls))->not->toContain('key:generate');
});

it('runs only the named seeders on an existing database, never the full one', function () {
    Staff::factory()->create();
    $calls = fakeSetupArtisan();

    $this->post('/internal/setup/'.SETUP_TEST_TOKEN)->assertOk()->assertSee('Update');

    $seeders = array_values(array_filter(setupCommands($calls), fn (string $command): bool => str_starts_with($command, 'db:seed')));
    expect($seeders)->toBe(array_map(fn (string $seeder): string => 'db:seed:'.$seeder, WebSetup::UPDATE_SEEDERS));
});

it('creates the APP_KEY only when it is empty, before anything else', function () {
    config(['app.key' => '']);
    $calls = fakeSetupArtisan(effects: ['key:generate' => fn () => config(['app.key' => 'base64:'.base64_encode(random_bytes(32))])]);

    $this->post('/internal/setup/'.SETUP_TEST_TOKEN)->assertOk()->assertSee('APP_KEY: leer');

    expect(setupCommands($calls)[0])->toBe('key:generate');
});

it('stops at a failed migration, keeps maintenance on and keeps the token usable for another try', function () {
    $calls = fakeSetupArtisan(['migrate' => 1]);

    $this->post('/internal/setup/'.SETUP_TEST_TOKEN)
        ->assertOk()
        ->assertSee('Nicht fertig')
        ->assertSee('Abbruch: migrate endete mit Code 1.');

    expect(setupCommands($calls))->toBe(['down', 'migrate'])
        ->and(app(SetupToken::class)->isSpent(SETUP_TEST_TOKEN))->toBeFalse();
    $this->get('/internal/setup/'.SETUP_TEST_TOKEN)->assertOk();
});

it('spends the token after a successful run: 404 from then on, until .env carries a new one', function () {
    fakeSetupArtisan();

    $this->post('/internal/setup/'.SETUP_TEST_TOKEN)->assertOk()->assertSee('ab jetzt gesperrt');

    $this->get('/internal/setup/'.SETUP_TEST_TOKEN)->assertNotFound();
    $this->post('/internal/setup/'.SETUP_TEST_TOKEN)->assertNotFound();
    $this->get('/internal/maintenance/'.SETUP_TEST_TOKEN.'/on')->assertNotFound();

    $fresh = str_repeat('f0', 32);
    config(['speedclub.setup.token' => $fresh]);
    $this->get('/internal/setup/'.$fresh)->assertOk();

    expect((string) file_get_contents(storage_path(SetupToken::SPENT_FILE)))->not->toContain(SETUP_TEST_TOKEN);
});

it('reads the token from the .env file, so a new token works although the config is cached', function () {
    $fromFile = str_repeat('ab', 32);
    file_put_contents($this->environmentDirectory.'/'.app()->environmentFile(), "APP_NAME=x\nSETUP_TOKEN={$fromFile}\n");
    fakeSetupArtisan();

    $this->get('/internal/setup/'.SETUP_TEST_TOKEN)->assertNotFound();
    $this->get('/internal/setup/'.$fromFile)->assertOk();
});

it('is gone once the line is removed from .env, although the cached config still holds the token', function () {
    file_put_contents($this->environmentDirectory.'/'.app()->environmentFile(), "APP_NAME=x\n");
    $calls = fakeSetupArtisan();

    $this->get('/internal/setup/'.SETUP_TEST_TOKEN)->assertNotFound();
    $this->get('/internal/maintenance/'.SETUP_TEST_TOKEN.'/on')->assertNotFound();
    expect($calls->count())->toBe(0);
});

it('runs nothing while another run holds the lock', function () {
    $calls = fakeSetupArtisan();
    $handle = fopen(storage_path('framework/setup.lock'), 'c');
    flock($handle, LOCK_EX);

    try {
        $this->post('/internal/setup/'.SETUP_TEST_TOKEN)->assertStatus(409)->assertSee('läuft gerade');
        expect($calls->count())->toBe(0);
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
});

it('switches maintenance mode on and off with the token, and refuses other states', function () {
    $calls = fakeSetupArtisan();

    $this->get('/internal/maintenance/'.SETUP_TEST_TOKEN.'/on')->assertOk();
    $this->post('/internal/maintenance/'.SETUP_TEST_TOKEN.'/off')->assertOk();
    $this->get('/internal/maintenance/'.SETUP_TEST_TOKEN.'/toggle')->assertNotFound();

    expect(setupCommands($calls))->toBe(['down', 'up'])
        ->and($calls[0][1])->toBe(['--retry' => 60]);
});

it('audits the setup run and every maintenance switch', function () {
    fakeSetupArtisan();

    $this->get('/internal/maintenance/'.SETUP_TEST_TOKEN.'/on')->assertOk();
    $this->post('/internal/setup/'.SETUP_TEST_TOKEN)->assertOk();

    expect(DB::table('audit_events')->where('action', 'setup.maintenance')->count())->toBe(1);
    $row = DB::table('audit_events')->where('action', WebSetup::AUDIT_ACTION)->first();
    expect($row)->not->toBeNull()
        ->and(json_decode((string) $row->after, true))->toMatchArray(['ok' => true, 'first_install' => true]);
});

it('stays reachable in maintenance mode while the site and the cron URL answer 503', function () {
    config(['speedclub.scheduler.cron_token' => str_repeat('c1', 32)]);
    app()->maintenanceMode()->activate(['retry' => 60]);

    try {
        $this->get('/')->assertStatus(503);
        $this->get('/internal/cron/'.str_repeat('c1', 32))->assertStatus(503);
        $this->get('/internal/setup/'.SETUP_TEST_TOKEN)->assertOk()->assertSee('Wartungsmodus: AN');
    } finally {
        app()->maintenanceMode()->deactivate();
    }
});

it('works without APP_KEY: no session, no cookie middleware, no named route', function () {
    foreach (['/internal/setup/'.SETUP_TEST_TOKEN, '/internal/maintenance/'.SETUP_TEST_TOKEN.'/on'] as $uri) {
        $route = Route::getRoutes()->match(Request::create($uri, 'POST'));
        $middleware = app('router')->gatherRouteMiddleware($route);

        expect($route->getName())->toBeNull()
            ->and($middleware)->not->toContain(StartSession::class)
            ->and($middleware)->not->toContain(EncryptCookies::class);
    }

    config(['app.key' => '']);
    fakeSetupArtisan();
    $this->get('/internal/setup/'.SETUP_TEST_TOKEN)->assertOk();
});

it('answers before the first setup, with an empty APP_KEY and encrypted sessions, as on a fresh host', function () {
    // As in production: SESSION_ENCRYPT=true, and nothing has built the encrypter, session or response factory yet. response() and
    // abort() would resolve the session store through the redirector and fail on the missing key (500 instead of the page).
    config(['app.key' => '', 'session.encrypt' => true, 'session.driver' => 'array']);
    foreach (['encrypter', 'session', 'session.store', 'redirect', ResponseFactory::class, Encrypter::class] as $abstract) {
        app()->forgetInstance($abstract);
    }
    fakeSetupArtisan();

    $this->get('/internal/setup/'.SETUP_TEST_TOKEN)->assertOk()->assertSee('Einrichtung starten');
    $this->get('/internal/setup/'.str_repeat('0', 64))->assertNotFound();
    $this->get('/internal/maintenance/'.str_repeat('0', 64).'/on')->assertNotFound();
});

/*
 * Client round 6 (go-live): the Owners of STAFF_OWNER_EMAIL (the platform owner, then a second Owner, comma-separated) get a one-time
 * set-password link from the installer; nobody ever sees or types a password for them.
 */
function seedSetupOwners(string $emails): void
{
    config(['speedclub.staff.owner_email' => $emails]);
    test()->seed(StaffSeeder::class);
    // As on a host outside local/testing: a seeded account has a password nobody knows until it is set by e-mail (SEC-P1-20).
    Staff::query()->update(['password_proof_required' => true]);
}

it('makes every address of STAFF_OWNER_EMAIL an Owner, trimmed, lower-cased, without repeats', function () {
    seedSetupOwners(' Info@JoinSpeedclub.test , second@joinspeedclub.test,info@joinspeedclub.test, kaputt');

    expect(StaffSeeder::ownerEmails())->toBe(['info@joinspeedclub.test', 'second@joinspeedclub.test'])
        ->and(Staff::query()->role('owner', 'staff')->orderBy('email')->pluck('email')->all())->toBe(['info@joinspeedclub.test', 'second@joinspeedclub.test']);
});

it('sends each Owner without a password of their own a one-time set-password link after a successful run, and names them masked', function () {
    seedSetupOwners('info@joinspeedclub.test, second@joinspeedclub.test');
    $client = Staff::query()->where('email', 'info@joinspeedclub.test')->sole();
    $second = Staff::query()->where('email', 'second@joinspeedclub.test')->sole();
    Notification::fake();
    fakeSetupArtisan();

    $this->post('/internal/setup/'.SETUP_TEST_TOKEN)->assertOk()
        ->assertSee('i***@joinspeedclub.test')->assertSee('s***@joinspeedclub.test')->assertSee('Link zum Passwort-Setzen')
        ->assertDontSee('info@joinspeedclub.test')->assertDontSee('second@joinspeedclub.test');

    Notification::assertSentTo($client, ResetPassword::class, fn (ResetPassword $n): bool => Password::broker('staff')->tokenExists($client, $n->token));
    Notification::assertSentTo($second, ResetPassword::class);
    Notification::assertCount(2);
});

it('sends no link to an Owner who set a password or signed in, or to a non-Owner', function () {
    seedSetupOwners('info@joinspeedclub.test, second@joinspeedclub.test');
    Staff::query()->where('email', 'info@joinspeedclub.test')->update(['password_proof_required' => false]);
    Staff::query()->where('email', 'second@joinspeedclub.test')->update(['last_login_at' => now()]);
    $admin = Staff::factory()->create(['email' => 'admin@joinspeedclub.test', 'password_proof_required' => true]);
    $admin->assignRole('admin');
    config(['speedclub.staff.owner_email' => 'info@joinspeedclub.test, second@joinspeedclub.test, admin@joinspeedclub.test']);
    Notification::fake();
    fakeSetupArtisan();

    $this->post('/internal/setup/'.SETUP_TEST_TOKEN)->assertOk()->assertSee('Fertig')->assertDontSee('Link zum Passwort-Setzen');

    Notification::assertNothingSent();
});

it('sends no link when the run fails', function () {
    seedSetupOwners('info@joinspeedclub.test');
    Notification::fake();
    fakeSetupArtisan(['migrate' => 1]);

    $this->post('/internal/setup/'.SETUP_TEST_TOKEN)->assertDontSee('Link zum Passwort-Setzen');

    Notification::assertNothingSent();
});
