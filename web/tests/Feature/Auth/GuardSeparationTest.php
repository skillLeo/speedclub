<?php

use App\Models\Staff;
use App\Models\User;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia;

/**
 * 05_ARCHITECTURE §8: members and staff are fully separated. These tests send real session cookies.
 */
function memberCookieName(): string
{
    return config()->string('session.cookie');
}

beforeEach(function () {
    // A protected member endpoint: API modules are not built yet.
    Route::middleware(['api', 'auth:sanctum'])->get('api/v1/test-member-only', fn () => response()->noContent());
});

it('redirects guests away from the admin portal', function () {
    $this->get('/admin')->assertRedirect('/admin/login');
});

it('does not let a member session reach /admin', function () {
    $session = databaseSessionFor(User::factory()->create(), 'web');

    $this->withCookie(memberCookieName(), $session)
        ->get('/admin')
        ->assertRedirect('/admin/login');
});

it('does not let a member session reach /admin even under the staff cookie name', function () {
    $session = databaseSessionFor(User::factory()->create(), 'web');

    $this->withCookie('sc_staff_session', $session)
        ->get('/admin')
        ->assertRedirect('/admin/login');
});

it('does not let a member token reach /admin', function () {
    $token = User::factory()->create()->createToken('phone')->plainTextToken;

    $this->withToken($token)->get('/admin')->assertRedirect('/admin/login');
});

it('lets an enrolled staff session reach /admin', function () {
    $staff = Staff::factory()->twoFactorConfirmed()->create();
    $session = databaseSessionFor($staff, 'staff');

    $this->withCookie('sc_staff_session', $session)
        ->get('/admin')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Dashboard/Index')
            ->where('staff.id', $staff->id));
});

it('ignores a staff session on the default session cookie at /admin', function () {
    $session = databaseSessionFor(Staff::factory()->create(), 'staff');

    $this->withCookie(memberCookieName(), $session)
        ->get('/admin')
        ->assertRedirect('/admin/login');
});

it('authenticates a member session on the API (control for the tests below)', function () {
    $session = databaseSessionFor(User::factory()->create(), 'web');

    $this->withCookie(memberCookieName(), $session)
        ->withHeaders(['Origin' => 'http://localhost:8080', 'Accept' => 'application/json'])
        ->get('/api/v1/test-member-only')
        ->assertNoContent();
});

it('does not authenticate a staff session on the API', function (string $cookie) {
    $session = databaseSessionFor(Staff::factory()->create(), 'staff');

    $this->withCookie($cookie === 'default' ? memberCookieName() : $cookie, $session)
        ->withHeaders(['Origin' => 'http://localhost:8080', 'Accept' => 'application/json'])
        ->get('/api/v1/test-member-only')
        ->assertUnauthorized()
        ->assertJsonPath('code', 'unauthenticated');
})->with(['default', 'sc_staff_session']);

it('authenticates a member token on the API', function () {
    $token = User::factory()->create()->createToken('phone')->plainTextToken;

    $this->withToken($token)->get('/api/v1/test-member-only')->assertNoContent();
});

it('sets the staff cookie on path /admin and no default session cookie', function () {
    $memberCookie = memberCookieName();
    $response = $this->get('/admin/login')->assertOk();

    $cookie = $response->getCookie('sc_staff_session', decrypt: false);

    expect($cookie)->not->toBeNull()
        ->and($cookie->getPath())->toBe('/admin')
        ->and($cookie->isHttpOnly())->toBeTrue()
        ->and($response->getCookie($memberCookie, decrypt: false))->toBeNull();
});
