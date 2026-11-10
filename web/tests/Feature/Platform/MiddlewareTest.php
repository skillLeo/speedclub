<?php

use App\Enums\RestrictionType;
use App\Models\User;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

describe('ETag', function () {
    beforeEach(function () {
        Route::middleware(['api', 'etag'])->prefix('api/v1/test')->group(function () {
            Route::get('cached', fn () => response()->json(['data' => 'body']));
            Route::post('cached', fn () => response()->json(['data' => 'body']));
            Route::get('missing', fn () => abort(404));
        });
    });

    it('adds a strong ETag and makes clients revalidate', function () {
        $response = $this->getJson('/api/v1/test/cached')->assertOk();

        expect($response->headers->get('ETag'))->toMatch('/^"[0-9a-f]{32}"$/')
            ->and($response->headers->get('Cache-Control'))->toContain('no-cache')->toContain('private')
            ->and($response->headers->get('Vary'))->toContain('Accept-Language');
    });

    it('answers 304 without a body for a matching tag', function (Closure $header) {
        $etag = $this->getJson('/api/v1/test/cached')->headers->get('ETag');

        $response = $this->withHeader('If-None-Match', $header($etag))->getJson('/api/v1/test/cached')->assertStatus(304);

        expect($response->getContent())->toBe('')
            ->and($response->headers->get('ETag'))->toBe($etag);
    })->with([
        'exact' => [fn (string $etag): string => $etag],
        'weak' => [fn (string $etag): string => 'W/'.$etag],
        'gzip suffix from Apache mod_deflate' => [fn (string $etag): string => substr($etag, 0, -1).'-gzip"'],
        'one of a list' => [fn (string $etag): string => '"other", '.$etag],
        'wildcard' => [fn (string $etag): string => '*'],
    ]);

    it('answers 200 for another tag', function () {
        $this->withHeader('If-None-Match', '"different"')->getJson('/api/v1/test/cached')->assertOk();
    });

    it('leaves errors and writes alone', function () {
        expect($this->getJson('/api/v1/test/missing')->assertNotFound()->headers->has('ETag'))->toBeFalse()
            ->and($this->postJson('/api/v1/test/cached')->assertOk()->headers->has('ETag'))->toBeFalse();
    });
});

describe('EnsureNotRestricted', function () {
    beforeEach(function () {
        Route::middleware(['api', 'auth:sanctum'])->prefix('api/v1/test')->group(function () {
            Route::post('messages', fn () => response()->noContent())->middleware('not-restricted:messaging');
            Route::post('publish', fn () => response()->noContent())->middleware('not-restricted:publishing');
        });
    });

    it('lets an unrestricted member through', function () {
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/v1/test/messages')->assertNoContent();
        $this->postJson('/api/v1/test/publish')->assertNoContent();
    });

    it('checks only the named restriction', function () {
        Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Messaging)->create());

        $this->postJson('/api/v1/test/publish')->assertNoContent();
        $this->postJson('/api/v1/test/messages')->assertForbidden()->assertJsonPath('code', 'account_restricted');
    });

    it('answers with the until-date, in the language of the request', function (string $locale, string $format, string $start) {
        $until = now()->addDays(3)->startOfSecond();
        Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Messaging, $until)->create());

        $this->withHeader('Accept-Language', $locale)
            ->postJson('/api/v1/test/messages')
            ->assertForbidden()
            ->assertJsonPath('until', $until->toIso8601String())
            ->assertJsonPath('errors', [])
            ->assertJsonPath('message', $start.$until->copy()->setTimezone('Europe/Berlin')->format($format).($locale === 'de' ? ' Uhr eingeschränkt.' : '.'));
    })->with([
        'de' => ['de', 'd.m.Y, H:i', 'Dein Konto ist für diese Aktion bis zum '],
        'en' => ['en', 'j M Y, H:i', 'Your account is restricted for this action until '],
    ]);

    it('has no until-date for an open-ended restriction', function () {
        Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create());

        $this->postJson('/api/v1/test/publish')
            ->assertForbidden()
            ->assertJsonPath('until', null)
            ->assertJsonPath('message', __('errors.account_restricted'));
    });

    it('ignores a lapsed restriction', function () {
        Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Messaging, now()->subDay())->create());

        $this->postJson('/api/v1/test/messages')->assertNoContent();
    });

    it('treats a suspension as restricting everything', function () {
        Sanctum::actingAs(User::factory()->suspended()->create());

        $this->postJson('/api/v1/test/messages')->assertForbidden()->assertJsonPath('code', 'account_restricted');
        $this->postJson('/api/v1/test/publish')->assertForbidden()->assertJsonPath('code', 'account_restricted');
    });
});
