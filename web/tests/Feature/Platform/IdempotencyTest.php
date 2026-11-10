<?php

use App\Models\IdempotencyKey;
use App\Models\User;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->calls = 0;

    Route::middleware(['api', 'auth:sanctum', 'idempotent'])->prefix('api/v1/test')->group(function () {
        Route::post('create', function () {
            $this->calls++;

            return response()->json(['data' => ['call' => $this->calls]], 201, ['Location' => '/thing/1', 'X-Other' => 'no']);
        });
        Route::post('other', fn () => response()->json(['data' => 'other'], 201));
        Route::post('invalid', fn () => response()->json(['code' => 'validation_failed'], 422));
        Route::post('crash', fn () => throw new RuntimeException('boom'));
        Route::post('empty', fn () => response()->noContent());
    });

    Route::middleware(['api', 'idempotent'])->post('api/v1/test/open', fn () => response()->json(['data' => $this->calls++], 201));

    $this->member = User::factory()->create();
    Sanctum::actingAs($this->member);
});

function withKey(string $key = 'key-1'): array
{
    return ['Idempotency-Key' => $key];
}

it('replays the first response for 24 hours without running the action again', function () {
    $first = $this->postJson('/api/v1/test/create', ['a' => 1], withKey())->assertCreated();
    $second = $this->postJson('/api/v1/test/create', ['a' => 1], withKey())->assertCreated();

    expect($this->calls)->toBe(1)
        ->and($second->json())->toBe($first->json())
        ->and($first->headers->has('Idempotency-Replayed'))->toBeFalse()
        ->and($second->headers->get('Idempotency-Replayed'))->toBe('true')
        ->and($second->headers->get('Location'))->toBe('/thing/1')
        ->and($second->headers->has('X-Other'))->toBeFalse()
        ->and($second->headers->get('Content-Type'))->toContain('application/json');

    $row = IdempotencyKey::query()->sole();

    expect($row->expires_at->diffInHours(now()->addHours(24)))->toBeLessThan(1);
});

it('runs every request without a key', function () {
    $this->postJson('/api/v1/test/create')->assertCreated();
    $this->postJson('/api/v1/test/create')->assertCreated();

    expect($this->calls)->toBe(2)
        ->and(IdempotencyKey::query()->count())->toBe(0);
});

it('scopes the key to the member', function () {
    $this->postJson('/api/v1/test/create', [], withKey())->assertCreated();

    Sanctum::actingAs(User::factory()->create());
    $this->postJson('/api/v1/test/create', [], withKey())->assertCreated();

    expect($this->calls)->toBe(2);
});

it('scopes the key to the route', function () {
    $this->postJson('/api/v1/test/create', [], withKey())->assertCreated()->assertJsonPath('data.call', 1);
    $this->postJson('/api/v1/test/other', [], withKey())->assertCreated()->assertJsonPath('data', 'other');
});

it('refuses the same key with a different body, under a code of its own', function () {
    $this->postJson('/api/v1/test/create', ['a' => 1], withKey())->assertCreated();

    $this->postJson('/api/v1/test/create', ['a' => 2], withKey())
        ->assertConflict()
        ->assertJsonPath('code', 'idempotency_key_reused')
        ->assertJsonPath('message', __('errors.idempotency_key_reused'));

    expect($this->calls)->toBe(1);
});

it('says so in plain words, without the name of the header', function (string $locale) {
    $message = trans('errors.idempotency_key_reused', [], $locale);

    expect($message)->not->toBe('errors.idempotency_key_reused')
        ->and(mb_strtolower($message))->not->toContain('idempotency')
        ->and(mb_strtolower($message))->not->toContain('key');
})->with(['de', 'en']);

it('answers 409 with Retry-After while the first request is still running', function () {
    IdempotencyKey::factory()->create([
        'user_id' => $this->member->id,
        'route' => 'POST api/v1/test/create',
        'key' => 'key-1',
        'request_hash' => null,
        'response_status' => null,
        'response_body' => null,
        'expires_at' => now()->addDay(),
    ]);

    // Same fingerprint as the in-flight request: keyed with the app key since SEC-P2-01.
    $row = IdempotencyKey::query()->sole();
    $row->forceFill(['request_hash' => hash_hmac('sha256', (string) json_encode([[], []]), (string) config('app.key'))])->save();

    $this->postJson('/api/v1/test/create', [], withKey())
        ->assertConflict()
        ->assertHeader('Retry-After', '2')
        ->assertJsonPath('message', __('errors.idempotency_in_flight'));

    expect($this->calls)->toBe(0);
});

it('lets a retry take over a key whose first request crashed long ago', function () {
    $row = IdempotencyKey::factory()->create([
        'user_id' => $this->member->id,
        'route' => 'POST api/v1/test/create',
        'key' => 'key-1',
        'response_status' => null,
        'response_body' => null,
        'expires_at' => now()->addDay(),
    ]);
    $row->forceFill(['created_at' => now()->subMinutes(5)])->save();

    $this->postJson('/api/v1/test/create', [], withKey())->assertCreated();

    expect($this->calls)->toBe(1);
});

it('runs again after the key expired', function () {
    IdempotencyKey::factory()->create([
        'user_id' => $this->member->id,
        'route' => 'POST api/v1/test/create',
        'key' => 'key-1',
        'response_status' => 201,
        'response_body' => '{"data":{"call":99}}',
        'expires_at' => now()->subMinute(),
    ]);

    $this->postJson('/api/v1/test/create', [], withKey())->assertCreated()->assertJsonPath('data.call', 1);
});

it('does not remember failures, so the same key can be retried', function (string $uri, int $status) {
    $this->postJson($uri, [], withKey())->assertStatus($status);

    expect(IdempotencyKey::query()->count())->toBe(0);
})->with([
    'validation' => ['/api/v1/test/invalid', 422],
    'server error' => ['/api/v1/test/crash', 500],
]);

it('does not store responses it cannot replay', function () {
    $this->postJson('/api/v1/test/empty', [], withKey())->assertNoContent();

    expect(IdempotencyKey::query()->count())->toBe(0);
});

it('rejects an unusable key', function (string $key) {
    $this->postJson('/api/v1/test/create', [], withKey($key))->assertStatus(400)->assertJsonPath('code', 'bad_request');

    expect($this->calls)->toBe(0);
})->with([
    'too long' => [str_repeat('a', 129)],
    'control characters' => ["a\tb"],
]);

it('passes guests through', function () {
    $this->app['auth']->forgetGuards();

    $this->postJson('/api/v1/test/open', [], withKey())->assertCreated();
    $this->postJson('/api/v1/test/open', [], withKey())->assertCreated();

    expect($this->calls)->toBe(2)
        ->and(IdempotencyKey::query()->count())->toBe(0);
});

it('prunes expired keys and leaves the others', function () {
    $keep = IdempotencyKey::factory()->create(['expires_at' => now()->addHour()]);
    IdempotencyKey::factory()->create(['expires_at' => now()->subHour()]);

    $this->artisan('speedclub:prune-platform')->assertSuccessful();

    expect(IdempotencyKey::query()->pluck('id')->all())->toBe([$keep->id]);
});
