<?php

use App\Enums\MemberSecurityEvent;
use App\Enums\SecurityNotice;
use App\Mail\SecurityNoticeMail;
use App\Models\AuditEvent;
use App\Models\PushToken;
use App\Models\User;
use App\Services\Auth\DeviceInstalls;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

require_once __DIR__.'/SettingsTestHelpers.php';

beforeEach(function () {
    // Symfony's test requests say en-us; the copy checked here is German.
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
});

function setBrowserSession(User $user, string $agent): string
{
    config(['session.driver' => 'database']);
    $id = Str::random(40);
    DB::table('sessions')->insert(['id' => $id, 'user_id' => $user->id, 'ip_address' => '203.0.113.9', 'user_agent' => $agent, 'payload' => base64_encode('a:0:{}'), 'last_activity' => now()->getTimestamp()]);

    return $id;
}

it('lists app installs and browsers, this device first, without IP or place', function () {
    $member = setMember();
    $here = setSignIn($member, 'install-here-0001', 'iPhone 15 Pro');
    setSignIn($member, 'install-there-001', 'Pixel 9');
    setBrowserSession($member, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Chrome/131.0 Safari/537.36');

    $response = $this->withToken($here)->getJson('/api/v1/me/sessions')->assertOk();
    $rows = $response->json('data');

    expect($rows)->toHaveCount(3)
        ->and($rows[0])->toMatchArray(['kind' => 'app', 'device_name' => 'iPhone 15 Pro', 'platform' => 'ios', 'app_version' => '0.1.0', 'current' => true])
        ->and(collect($rows)->pluck('device_name')->all())->toContain('Pixel 9', 'Chrome auf macOS')
        ->and(collect($rows)->where('current', true))->toHaveCount(1)
        ->and(json_encode($rows))->not->toContain('203.0.113.9');

    foreach ($rows as $row) {
        expect(array_keys($row))->toBe(['id', 'kind', 'device_name', 'platform', 'app_version', 'last_used_at', 'current', 'os_version', 'approx_city', 'signed_in_at']);
    }
});

it('ends one other device with its push token, never this one', function () {
    $member = setMember();
    $here = setSignIn($member, 'install-here-0001');
    $there = setSignIn($member, 'install-there-001', 'Pixel 9');
    PushToken::factory()->create(['user_id' => $member->id, 'device_id' => DeviceInstalls::key($member->id, 'install-there-001'), 'token' => 'ExponentPushToken[dddddddddddddddddddddd]']);

    $rows = collect($this->withToken($here)->getJson('/api/v1/me/sessions')->json('data'));
    $other = $rows->firstWhere('current', false)['id'];
    $mine = $rows->firstWhere('current', true)['id'];

    $this->withToken($here)->deleteJson('/api/v1/me/sessions/'.$mine)->assertUnprocessable()->assertJsonValidationErrors('id');
    $this->withToken($here)->deleteJson('/api/v1/me/sessions/'.$other)->assertNoContent();
    app('auth')->forgetGuards();

    $this->withToken($there)->getJson('/api/v1/auth/me')->assertUnauthorized();
    app('auth')->forgetGuards();
    $this->withToken($here)->getJson('/api/v1/auth/me')->assertOk();
    expect($member->pushTokens()->count())->toBe(0)
        ->and(AuditEvent::query()->where('action', MemberSecurityEvent::SessionRevoked->value)->exists())->toBeTrue();
    Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::SessionsRevoked);
});

it('ends a browser session by its opaque id', function () {
    $member = setMember();
    $here = setSignIn($member, 'install-here-0001');
    $session = setBrowserSession($member, 'Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/133.0');

    $row = collect($this->withToken($here)->getJson('/api/v1/me/sessions')->json('data'))->firstWhere('kind', 'web');
    expect($row['id'])->toStartWith('w')->not->toContain($session)->and($row['device_name'])->toBe('Firefox auf Windows');

    $this->withToken($here)->deleteJson('/api/v1/me/sessions/'.$row['id'])->assertNoContent();
    expect(DB::table('sessions')->where('id', $session)->exists())->toBeFalse();
});

it('ends every other device and browser at once', function () {
    $member = setMember();
    $here = setSignIn($member, 'install-here-0001');
    $there = setSignIn($member, 'install-there-001', 'Pixel 9');
    setBrowserSession($member, 'Safari');
    $stranger = setMember();
    $strangerSession = setBrowserSession($stranger, 'Safari');

    $this->withToken($here)->deleteJson('/api/v1/me/sessions')->assertNoContent();
    app('auth')->forgetGuards();

    $this->withToken($there)->getJson('/api/v1/auth/me')->assertUnauthorized();
    app('auth')->forgetGuards();
    expect($this->withToken($here)->getJson('/api/v1/me/sessions')->json('data'))->toHaveCount(1)
        ->and(DB::table('sessions')->where('id', $strangerSession)->exists())->toBeTrue();
});

it('answers 404 for an unknown or foreign id', function () {
    $member = setMember();
    $here = setSignIn($member, 'install-here-0001');
    $stranger = setMember();
    $foreign = setSignIn($stranger, 'install-zzzz-0009');
    app('auth')->forgetGuards();
    $foreignId = 't'.$stranger->tokens()->value('id');

    $this->withToken($here)->deleteJson('/api/v1/me/sessions/'.$foreignId)->assertNotFound();
    $this->withToken($here)->deleteJson('/api/v1/me/sessions/t999999')->assertNotFound();
    $this->withToken($here)->deleteJson('/api/v1/me/sessions/wdeadbeef')->assertNotFound();
    app('auth')->forgetGuards();
    $this->withToken($foreign)->getJson('/api/v1/auth/me')->assertOk();
});

it('lists one row per install right after a rotation', function () {
    $member = setMember();
    $token = setSignIn($member, 'install-here-0001');
    $member->tokens()->update(['created_at' => now()->subDays(8)]);

    $new = (string) $this->withToken($token)->postJson('/api/v1/auth/token/rotate', ['device_id' => 'install-here-0001'])->assertOk()->json('data.token');
    app('auth')->forgetGuards();

    expect($member->tokens()->count())->toBe(2)
        ->and($this->withToken($new)->getJson('/api/v1/me/sessions')->json('data'))->toHaveCount(1);
});
