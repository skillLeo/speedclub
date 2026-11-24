<?php

use App\Http\Middleware\RedirectToCanonicalHost;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
 * Client round 7: www.joinspeedclub.com answered the whole site (admin included) next to the APP_URL host, with host-only cookies, so an
 * admin had two sessions. RedirectToCanonicalHost moves a trusted non-canonical host to APP_URL's host: 301 for GET/HEAD, 308 otherwise.
 */
beforeEach(function (): void {
    config([
        'app.url' => 'https://joinspeedclub.com',
        'speedclub.trusted_hosts' => ['www.joinspeedclub.com', '192.168.1.20', 'localhost'],
        'speedclub.staff.domain' => null,
    ]);
    Route::middleware(RedirectToCanonicalHost::class)->any('/_canonical-probe/{rest?}', fn () => response('here'))->where('rest', '.*');
});

it('sends a GET and a HEAD on www to the APP_URL host with 301, path and query kept', function (string $method): void {
    $response = $this->call($method, 'https://www.joinspeedclub.com/_canonical-probe/admin/settings?tab=org&x=1');

    $response->assertStatus(301);
    expect($response->headers->get('Location'))->toBe('https://joinspeedclub.com/_canonical-probe/admin/settings?tab=org&x=1');
})->with(['GET', 'HEAD']);

it('sends a write on www to the APP_URL host with 308, so the method and body are kept', function (string $method): void {
    $response = $this->call($method, 'https://www.joinspeedclub.com/_canonical-probe/admin/settings', ['values' => ['phone' => '1']]);

    $response->assertStatus(308);
    expect($response->headers->get('Location'))->toBe('https://joinspeedclub.com/_canonical-probe/admin/settings');
})->with(['POST', 'PATCH', 'PUT', 'DELETE']);

it('leaves the APP_URL host alone', function (): void {
    $this->get('https://joinspeedclub.com/_canonical-probe/x')->assertOk()->assertSee('here');
    $this->post('https://joinspeedclub.com/_canonical-probe/x')->assertOk();
});

it('leaves the staging host alone: there it is APP_URL', function (): void {
    config(['app.url' => 'https://coral-okapi-906483.hostingersite.com', 'speedclub.trusted_hosts' => []]);

    $this->get('https://coral-okapi-906483.hostingersite.com/_canonical-probe/x')->assertOk();
});

it('leaves localhost, IP addresses and the admin domain alone even when trusted', function (string $url): void {
    config(['speedclub.staff.domain' => 'admin.joinspeedclub.com', 'speedclub.trusted_hosts' => ['www.joinspeedclub.com', '192.168.1.20', 'localhost', 'admin.joinspeedclub.com']]);

    $this->get($url)->assertOk();
})->with([
    'localhost' => 'http://localhost:8080/_canonical-probe/x',
    'LAN address' => 'http://192.168.1.20:8080/_canonical-probe/x',
    'loopback' => 'http://127.0.0.1/_canonical-probe/x',
    'admin domain' => 'https://admin.joinspeedclub.com/_canonical-probe/x',
]);

it('never redirects to a host it was not told to trust', function (): void {
    // TrustHosts refuses such a Host before this middleware in production; the middleware itself does not move it either.
    expect(RedirectToCanonicalHost::target(Request::create('https://evil.example/_canonical-probe/x')))->toBeNull();
});

it('keeps the health check reachable on every host', function (): void {
    expect(RedirectToCanonicalHost::target(Request::create('https://www.joinspeedclub.com/up')))->toBeNull();
});

it('compares hosts without regard to case', function (): void {
    config(['speedclub.trusted_hosts' => ['WWW.JoinSpeedclub.com']]);

    $response = $this->get('https://www.joinspeedclub.com/_canonical-probe/x');

    $response->assertStatus(301);
    expect($response->headers->get('Location'))->toBe('https://joinspeedclub.com/_canonical-probe/x');
});
