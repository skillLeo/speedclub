<?php

use App\Enums\RestrictionType;
use App\Models\DataExport;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SettingsTestHelpers.php';

beforeEach(function () {
    // Symfony's test requests say en-us; the copy checked here is German.
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
});

/**
 * Every M2.5 member route with a body that would pass validation; the action may still refuse (wrong state), never the gate.
 *
 * @return array<string, array{0: string, 1: string, 2: array<string, mixed>}>
 */
function setMemberRoutes(): array
{
    return [
        'GET me/sessions' => ['GET', '/api/v1/me/sessions', []],
        // M4.7 (09 §8.4): recent authentication, or the password.
        'DELETE me/sessions' => ['DELETE', '/api/v1/me/sessions', ['password' => 'password']],
        // M4.7 SET-19, SET-21.
        'GET me/sign-in-methods' => ['GET', '/api/v1/me/sign-in-methods', []],
        'GET me/security-events' => ['GET', '/api/v1/me/security-events', []],
        'POST me/security/secure' => ['POST', '/api/v1/me/security/secure', []],
        'DELETE me/sessions/{id}' => ['DELETE', '/api/v1/me/sessions/t1', []],
        'GET me/exports' => ['GET', '/api/v1/me/exports', []],
        'POST me/export' => ['POST', '/api/v1/me/export', ['password' => 'password']],
        'POST me/email' => ['POST', '/api/v1/me/email', ['email' => 'neu@example.de', 'password' => 'password']],
        'POST me/email/confirm' => ['POST', '/api/v1/me/email/confirm', ['code' => '123456']],
        'POST me/password' => ['POST', '/api/v1/me/password', ['current_password' => 'password', 'password' => 'Ein-neues-Passwort-26', 'password_confirmation' => 'Ein-neues-Passwort-26']],
        'POST me/two-factor' => ['POST', '/api/v1/me/two-factor', ['password' => 'password']],
        'POST me/two-factor/confirm' => ['POST', '/api/v1/me/two-factor/confirm', ['code' => '123456']],
        'DELETE me/two-factor' => ['DELETE', '/api/v1/me/two-factor', ['password' => 'password', 'code' => '123456']],
        'POST me/two-factor/recovery-codes' => ['POST', '/api/v1/me/two-factor/recovery-codes', ['password' => 'password', 'code' => '123456']],
        'POST me/delete' => ['POST', '/api/v1/me/delete', ['password' => 'password']],
        'POST support/tickets' => ['POST', '/api/v1/support/tickets', ['category' => 'other', 'subject' => 'Frage', 'message' => 'Eine Frage zu meinem Konto.']],
    ];
}

it('answers 401 to a guest on every member route', function (string $method, string $uri, array $body) {
    $this->json($method, $uri, $body)->assertUnauthorized();
})->with(setMemberRoutes());

it('answers 403 to a deactivated account on every member route', function (string $method, string $uri, array $body) {
    Sanctum::actingAs(User::factory()->deactivated()->create());

    $this->json($method, $uri, $body)->assertForbidden();
})->with(setMemberRoutes());

it('keeps every route open to unverified, suspended and restricted members, apart from starting two-factor unverified', function (string $method, string $uri, array $body) {
    foreach ([
        'unverified' => User::factory()->unverified()->create(),
        'suspended' => User::factory()->suspended()->create(),
        'restricted' => User::factory()->restrictedFrom(RestrictionType::Publishing)->create(),
    ] as $kind => $member) {
        Sanctum::actingAs($member);
        $status = $this->json($method, $uri, $body)->status();

        if ($kind === 'unverified' && $method === 'POST' && $uri === '/api/v1/me/two-factor') {
            expect($status)->toBe(403);

            continue;
        }

        expect($status)->not->toBe(401)->not->toBe(403, "$kind on $method $uri");
    }
})->with(setMemberRoutes());

it('never reaches another member\'s sessions or exports', function () {
    $owner = setMember();
    $other = setMember();
    $ownerToken = setSignIn($owner, 'install-owner-001');
    DataExport::factory()->ready()->create(['user_id' => $owner->id]);
    app('auth')->forgetGuards();

    $otherToken = setSignIn($other, 'install-other-001');
    $this->withToken($otherToken);
    $this->getJson('/api/v1/me/exports')->assertOk()->assertJsonCount(0, 'data');
    $this->getJson('/api/v1/me/sessions')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.current', true);
    $this->deleteJson('/api/v1/me/sessions/t'.$owner->tokens()->value('id'))->assertNotFound();
    $this->deleteJson('/api/v1/me/sessions')->assertNoContent();
    app('auth')->forgetGuards();

    $this->withToken($ownerToken)->getJson('/api/v1/auth/me')->assertOk();
});

it('documents a member who must change the password: the member routes answer 403 password_change_required', function () {
    Sanctum::actingAs(User::factory()->create(['force_password_change' => true]));

    $this->getJson('/api/v1/me/sessions')->assertForbidden()->assertJsonPath('code', 'password_change_required');
    $this->postJson('/api/v1/me/delete', ['password' => 'password'])->assertForbidden();
});

it('takes guests on the public M2.5 routes', function () {
    $this->getJson('/api/v1/help')->assertOk();
    $this->get('/konto-loeschen')->assertOk();
    $this->get('/kontakt')->assertOk();
    $this->postJson('/api/v1/auth/two-factor/challenge', ['challenge' => str_repeat('a', 40), 'code' => '123456', 'device_name' => 'Pixel 9'])
        ->assertUnprocessable()->assertJsonPath('code', 'challenge_expired');
});
