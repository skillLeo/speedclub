<?php

use App\Console\Commands\ScheduleInlineCommand;
use App\Http\Controllers\Internal\CronController;
use App\Support\ClientAddress;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

/*
 * M5.11 (ADR-503): GET /internal/cron/{token} for ALL-INKL, whose cronjobs call a URL. Answers 204, then runs speedclub:schedule-inline.
 */

const CRON_TEST_TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-11-10 10:01:00', 'UTC'));
    config(['speedclub.scheduler.cron_token' => CRON_TEST_TOKEN]);
    RateLimiter::clear('cron-url|'.ClientAddress::key(request()));
    Artisan::command('test:cron-probe', function () {
        Cache::put('cron-probe', Cache::get('cron-probe', 0) + 1);
    });
    app(Schedule::class)->command('test:cron-probe')->everyMinute();
});

it('answers 204 without a cookie and runs the scheduler once', function () {
    $response = $this->get('/internal/cron/'.CRON_TEST_TOKEN)->assertNoContent();

    expect($response->headers->getCookies())->toBe([])
        ->and($response->headers->get('Cache-Control'))->toContain('no-store')
        ->and(Cache::get('cron-probe'))->toBe(1);
});

it('is a 404 when no token is configured, whatever the URL carries', function (string $configured) {
    config(['speedclub.scheduler.cron_token' => $configured]);

    $this->get('/internal/cron/'.CRON_TEST_TOKEN)->assertNotFound();
    $this->get('/internal/cron/'.$configured)->assertNotFound();

    expect(Cache::get('cron-probe'))->toBeNull();
})->with(['empty' => '', 'too short' => 'short-token-under-32']);

it('is a 404 for a wrong token and runs nothing', function (string $token) {
    $this->get('/internal/cron/'.$token)->assertNotFound();

    expect(Cache::get('cron-probe'))->toBeNull();
})->with(['wrong' => 'b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2', 'prefix' => substr(CRON_TEST_TOKEN, 0, 40), 'longer' => CRON_TEST_TOKEN.'x', 'odd characters' => 'a%00b']);

it('rejects methods other than GET', function () {
    $this->post('/internal/cron/'.CRON_TEST_TOKEN)->assertStatus(405);
    expect(Cache::get('cron-probe'))->toBeNull();
});

it('counts every request per address and answers 429 over the limit, a valid one included', function () {
    config(['speedclub.scheduler.cron_max_per_minute' => 3]);

    foreach (range(1, 3) as $ignored) {
        $this->get('/internal/cron/wrong-token-'.str_repeat('x', 40))->assertNotFound();
    }

    $this->get('/internal/cron/'.CRON_TEST_TOKEN)->assertStatus(429)->assertHeader('Retry-After');
    expect(Cache::get('cron-probe'))->toBeNull();

    $this->travel(61)->seconds();
    $this->get('/internal/cron/'.CRON_TEST_TOKEN)->assertNoContent();
    expect(Cache::get('cron-probe'))->toBe(1);
});

it('does nothing while another trigger holds the lock, and releases it after a run', function () {
    $lock = Cache::lock(CronController::LOCK, 120);
    expect($lock->get())->toBeTrue();

    $this->get('/internal/cron/'.CRON_TEST_TOKEN)->assertNoContent();
    expect(Cache::get('cron-probe'))->toBeNull();

    $lock->release();
    $this->get('/internal/cron/'.CRON_TEST_TOKEN)->assertNoContent();
    expect(Cache::get('cron-probe'))->toBe(1);

    // The lock is free again: the next minute runs.
    $this->get('/internal/cron/'.CRON_TEST_TOKEN)->assertNoContent();
    expect(Cache::get('cron-probe'))->toBe(2);
});

it('releases the lock and still answers 204 when the scheduler throws', function () {
    app(Schedule::class)->call(fn () => throw new RuntimeException('boom'))->everyMinute();

    $this->get('/internal/cron/'.CRON_TEST_TOKEN)->assertNoContent();

    expect(Cache::lock(CronController::LOCK, 5)->get())->toBeTrue();
});

it('is no named route, so no Ziggy list or route:list name carries it, and it starts no session', function () {
    $route = Route::getRoutes()->match(Request::create('/internal/cron/'.CRON_TEST_TOKEN));

    expect($route->getName())->toBeNull()
        ->and(app('router')->gatherRouteMiddleware($route))->not->toContain(StartSession::class);
});

it('keeps the CLI command for SSH hosts', function () {
    $this->artisan('speedclub:schedule-inline')->assertExitCode(0);
    expect(class_exists(ScheduleInlineCommand::class))->toBeTrue()->and(Cache::get('cron-probe'))->toBe(1);
});
