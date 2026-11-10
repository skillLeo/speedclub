<?php

use App\Models\User;
use Illuminate\Support\Facades\Mail;

/**
 * @return array<string, mixed>
 */
function openApiDocument(): array
{
    $path = tempnam(sys_get_temp_dir(), 'openapi');

    test()->artisan('scramble:export', ['--path' => $path])->assertSuccessful();

    /** @var array<string, mixed> $document */
    $document = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    unlink($path);

    return $document;
}

it('documents the platform endpoints with typed resources', function () {
    $document = openApiDocument();

    expect($document['paths'])->toHaveKeys([
        '/app-config',
        '/legal/{key}',
        '/catalog/makes',
        '/catalog/makes/{make}/models',
        '/catalog/models/{model}/generations',
        '/catalog/brands',
        '/catalog/mod-categories',
        '/catalog/requests',
        '/vehicles/{vehicle}/media',
        '/vehicles/{vehicle}/media/order',
        '/media/{media}',
    ])
        ->and($document['components']['schemas']['MediaResource']['properties']['status'])
        ->toBe(['$ref' => '#/components/schemas/MediaStatus'])
        ->and($document['components']['schemas']['AppConfigResource']['properties']['maintenance']['properties']['enabled']['type'])
        ->toBe('boolean');
});

it('states what the middleware and the error renderer really do', function () {
    $document = openApiDocument();
    $upload = $document['paths']['/vehicles/{vehicle}/media']['post'];
    $appConfig = $document['paths']['/app-config']['get'];

    expect(array_keys($upload['responses']))->toContain(201, 401, 403, 404, 409, 413, 415, 422, 429)
        ->and(array_column($upload['parameters'], 'name'))->toContain('Idempotency-Key')
        ->and($upload['responses'])->not->toHaveKey(200)
        ->and($upload['responses']['429']['headers'])->toHaveKey('Retry-After')
        ->and(array_keys($appConfig['responses']))->toContain(200, 304)
        ->and(array_column($appConfig['parameters'], 'name'))->toContain('If-None-Match')
        ->and($appConfig['security'])->toBe([])
        ->and($document['security'])->toBe([['bearerAuth' => []]])
        ->and($document['components']['schemas']['ApiError']['required'])->toBe(['message', 'code', 'errors'])
        ->and($document['components']['responses']['AuthenticationException']['content']['application/json']['schema'])
        ->toBe(['$ref' => '#/components/schemas/UnauthenticatedError'])
        ->and($document['components']['responses']['ModelNotFoundException']['content']['application/json']['schema'])
        ->toBe(['$ref' => '#/components/schemas/ApiError']);
});

it('documents the 413 of the JSON line on every write and on no read (SEC-P1-48)', function () {
    $paths = openApiDocument()['paths'];
    $writes = 0;

    foreach ($paths as $path => $operations) {
        foreach ($operations as $method => $operation) {
            $writes += $method === 'get' ? 0 : 1;

            expect(array_key_exists(413, $operation['responses']))->toBe($method !== 'get', "$method $path");
        }
    }

    expect($writes)->toBeGreaterThan(0)
        ->and($paths['/auth/login']['post']['responses'][413]['description'])->toContain('payload_too_large', '512 KB')
        ->and($paths['/auth/login']['post']['responses'][413]['content']['application/json']['schema'])->toBe(['$ref' => '#/components/schemas/ApiError'])
        // An upload has the limit of its own file to mention, and multipart is outside the JSON line.
        ->and($paths['/me/avatar']['post']['responses'][413]['description'])->toBe('Larger than the upload limit.');
});

it('says that a draft may have no make or model yet, on every schema that carries them (BH-00)', function () {
    $schemas = openApiDocument()['components']['schemas'];

    foreach (['VehicleCardResource', 'VehicleResource', 'PublicVehicleResource', 'FeedVehicleResource', 'VehicleSpecsSavedResource'] as $schema) {
        foreach (['make', 'model', 'eyebrow'] as $field) {
            expect($schemas[$schema]['properties'][$field]['type'])->toBe(['string', 'null'], "$schema.$field");
        }
    }
});

it('documents what an edit says about Verlauf, the failed photos and the code of a reused key', function () {
    $document = openApiDocument();
    $schemas = $document['components']['schemas'];

    expect($schemas['SavedModificationResource']['properties']['history_recorded']['type'])->toBe('boolean')
        ->and($schemas['SavedModificationResource']['required'])->toContain('history_recorded')
        ->and($schemas['VehicleSpecsSavedResource']['properties']['history_recorded']['type'])->toBe('boolean')
        ->and($schemas['VehicleSpecsSavedResource']['required'])->toContain('history_recorded')
        ->and($schemas['VehicleResource']['properties']['failed_photos']['items'])->toBe(['$ref' => '#/components/schemas/MediaResource'])
        ->and($schemas['PublicVehicleResource']['properties'])->not->toHaveKey('failed_photos')
        ->and($schemas['VehicleCardResource']['properties'])->not->toHaveKey('failed_photos')
        ->and($document['paths']['/vehicles/{vehicle}/media']['post']['responses']['409']['description'])->toContain('idempotency_key_reused');
});

it('describes the auth error bodies, so the mobile client does not hand-write them', function () {
    $document = openApiDocument();
    $schemas = $document['components']['schemas'];
    $body = fn (string $path, string $method, int $status) => $document['paths'][$path][$method]['responses'][$status]['content']['application/json']['schema'];
    $ref = fn (string $name) => ['$ref' => '#/components/schemas/'.$name];

    expect($body('/auth/login', 'post', 401))->toBe($ref('InvalidCredentialsError'))
        ->and($body('/auth/login', 'post', 403))->toBe(['anyOf' => [$ref('AccountRestrictedError'), $ref('PasswordChangeRequiredError')]])
        ->and($body('/auth/email/verify', 'post', 403))->toBe(['anyOf' => [$ref('AccountRestrictedError'), $ref('PasswordChangeRequiredError')]])
        ->and($body('/auth/login', 'post', 419))->toBe($ref('SessionExpiredError'))
        ->and($body('/auth/login', 'post', 429))->toBe($ref('RateLimitedError'))
        ->and($body('/auth/me', 'get', 401))->toBe($ref('UnauthenticatedError'))
        ->and($body('/auth/me', 'get', 403))->toBe(['anyOf' => [$ref('PasswordChangeRequiredError'), $ref('ForbiddenError')]])
        ->and($body('/auth/token/rotate', 'post', 409))->toBe(['anyOf' => [$ref('TokenRotationNotDueError'), $ref('ConflictError')]])
        ->and($body('/me/username', 'put', 409))->toBe($ref('UsernameChangeCooldownError'))
        ->and($body('/me/username', 'put', 403))->toBe(['anyOf' => [$ref('PasswordChangeRequiredError'), $ref('AccountRestrictedError'), $ref('ForbiddenError')]])
        ->and($document['paths']['/auth/logout']['post']['responses'])->not->toHaveKey(403)
        ->and($document['paths']['/auth/register']['post']['responses'][422])->toBe(['$ref' => '#/components/responses/ValidationException'])
        ->and($document['components']['responses']['ValidationException']['content']['application/json']['schema'])->toBe($ref('ValidationError'))
        ->and($schemas['ValidationError']['properties']['code']['enum'])->toBe(['validation_failed', 'invalid_code'])
        ->and($schemas['ValidationError']['required'])->toContain('errors')
        ->and($schemas['PasswordChangeRequiredError']['properties']['code']['enum'])->toBe(['password_change_required'])
        ->and($schemas['PasswordChangeRequiredError']['properties']['next']['enum'])->toBe(['reset_password'])
        ->and($schemas['PasswordChangeRequiredError']['required'])->toContain('next', 'email')
        ->and($schemas['AccountRestrictedError']['properties']['until']['type'])->toBe(['string', 'null'])
        ->and($schemas['AccountRestrictedError']['required'])->toContain('until')
        ->and($schemas['UsernameChangeCooldownError']['required'])->toContain('until')
        ->and($schemas['TokenRotationNotDueError']['required'])->toContain('retry_at')
        ->and($schemas['RateLimitedError']['properties']['code']['enum'])->toBe(['rate_limited']);
});

it('documents the garage, public and follow routes with their error bodies', function () {
    $document = openApiDocument();
    $schemas = $document['components']['schemas'];
    $ref = fn (string $name) => ['$ref' => '#/components/schemas/'.$name];
    $body = fn (string $path, string $method, int $status) => $document['paths'][$path][$method]['responses'][$status]['content']['application/json']['schema'];

    expect($document['paths'])->toHaveKeys([
        '/me/vehicles', '/me/vehicles/order', '/vehicles', '/vehicles/{vehicle}', '/vehicles/{vehicle}/specs', '/vehicles/{vehicle}/publish',
        '/vehicles/{vehicle}/main', '/vehicles/{vehicle}/visibility', '/vehicles/{vehicle}/updates', '/updates/{update}', '/vehicles/{vehicle}/mods',
        '/vehicles/{vehicle}/mods/order', '/mods/{modification}', '/mods/{modification}/media', '/public/vehicles/{slug}',
        '/public/vehicles/{slug}/mods/{modification}', '/public/vehicles/{slug}/updates', '/public/vehicles/{slug}/updates/{update}',
        '/public/users/{username}', '/public/users/{username}/vehicles', '/users/{username}/follow',
    ])
        // A route that now really carries verified-member, so the body is part of the export (ADR-139).
        ->and($body('/vehicles/{vehicle}/publish', 'post', 403)['anyOf'])->toContain($ref('EmailNotVerifiedError'))
        ->and($body('/users/{username}/follow', 'post', 403)['anyOf'])->toContain($ref('EmailNotVerifiedError'))
        ->and($body('/updates/{update}', 'patch', 403)['anyOf'])->toContain($ref('AccountRestrictedError'))
        ->and($body('/vehicles/{vehicle}/visibility', 'patch', 403)['anyOf'])->toContain($ref('AccountRestrictedError'))
        ->and($schemas['EmailNotVerifiedError']['properties']['code']['enum'])->toBe(['email_not_verified'])
        ->and($body('/vehicles/{vehicle}/publish', 'post', 422)['anyOf'])->toContain($ref('VehicleIncompleteError'))
        ->and($schemas['VehicleIncompleteError']['required'])->toContain('missing')
        ->and($schemas['VehicleIncompleteError']['properties']['missing']['items']['enum'])->toBe(['make', 'model', 'model_year', 'photo', 'username'])
        ->and($body('/public/vehicles/{slug}', 'get', 404))->toBe($ref('VehicleUnavailableError'))
        ->and(array_keys($document['paths']['/public/vehicles/{slug}']['get']['responses']))->toContain(200, 301, 304, 404, 429)
        ->and($document['paths']['/public/vehicles/{slug}']['get']['security'])->toBe([])
        ->and($document['paths']['/public/users/{username}']['get']['security'])->toBe([])
        ->and(array_column($document['paths']['/vehicles']['post']['parameters'], 'name'))->toContain('Idempotency-Key')
        ->and(array_keys($document['paths']['/vehicles']['post']['responses']))->toContain(201, 422, 429)
        ->and($schemas['PublicVehicleResource']['properties']['spec_strip']['type'])->toBe('array')
        ->and($schemas['PublicVehicleResource']['properties']['highlights']['items'])->toBe($ref('ModificationRowResource'))
        ->and($schemas['VehicleCardResource']['properties']['completeness']['properties']['percent']['type'])->toBe('integer')
        ->and($schemas['BuildUpdateResource']['properties']['changes']['items']['properties']['text']['type'])->toBe('string')
        ->and($schemas['ModificationRowResource']['properties']['cost']['type'])->toBe(['object', 'null']);
});

it('documents only bodies the server really sends', function () {
    Mail::fake();

    $member = User::factory()->create(['email' => 'pflicht@example.de', 'force_password_change' => true]);
    $schemas = openApiDocument()['components']['schemas'];

    $body = $this->postJson('/api/v1/auth/login', ['email' => 'pflicht@example.de', 'password' => 'password', 'device_name' => 'P'])
        ->assertForbidden()
        ->json();

    expect(array_keys($body))->toEqualCanonicalizing($schemas['PasswordChangeRequiredError']['required'])
        ->and($member->tokens()->count())->toBe(0);

    $this->postJson('/api/v1/auth/login', ['email' => 'keiner@example.de', 'password' => 'password', 'device_name' => 'P'])
        ->assertUnauthorized()
        ->assertJsonStructure($schemas['InvalidCredentialsError']['required']);
});

it('documents the auth and profile endpoints precisely enough for the mobile types', function () {
    $document = openApiDocument();
    $schemas = $document['components']['schemas'];
    $me = $schemas['MeResource']['properties'];

    expect($document['paths'])->toHaveKeys([
        '/auth/register', '/auth/login', '/auth/logout', '/auth/me', '/auth/email/verify', '/auth/email/resend',
        '/auth/password/forgot', '/auth/password/reset', '/auth/token/rotate', '/usernames/check', '/me/profile',
        '/me/username', '/me/avatar', '/me/cover', '/me/settings', '/legal',
    ])
        ->and(array_keys($document['paths']['/auth/register']['post']['responses']))->toContain(202, 422, 429)
        ->and(array_keys($document['paths']['/auth/login']['post']['responses']))->toContain(200, 401, 403, 419, 422, 429)
        ->and($document['paths']['/auth/register']['post']['security'])->toBe([])
        ->and($document['paths']['/auth/login']['post']['security'])->toBe([])
        ->and($document['paths']['/auth/me']['get'])->not->toHaveKey('security')
        ->and(array_column($document['paths']['/me/avatar']['post']['parameters'], 'name'))->toContain('Idempotency-Key')
        ->and($schemas['AuthSessionResource']['properties']['member'])->toBe(['$ref' => '#/components/schemas/MeResource'])
        ->and($schemas['AuthSessionResource']['properties']['token']['type'])->toBe(['string', 'null'])
        ->and($schemas['NextStepResource']['properties']['next'])->toBe(['$ref' => '#/components/schemas/AuthNextStep'])
        ->and($schemas['AuthNextStep']['enum'])->toBe(['verify_email', 'reset_password', 'sign_in'])
        ->and($schemas['OnboardingStep']['enum'])->toBe(['verify_email', 'choose_username', 'profile_setup'])
        ->and($schemas['UsernameUnavailableReason']['enum'])->toContain('taken', 'reserved', 'length')
        ->and($me['theme'])->toBe(['$ref' => '#/components/schemas/ThemePreference'])
        ->and($me['power_display'])->toBe(['$ref' => '#/components/schemas/PowerDisplay'])
        ->and($me['display_name']['type'])->toBe(['string', 'null'])
        ->and($me['username']['type'])->toBe(['string', 'null'])
        ->and($me['email_verified']['type'])->toBe('boolean')
        ->and($me['stats']['properties']['followers']['type'])->toBe('integer')
        ->and($me['restrictions']['properties']['publishing']['properties']['until']['type'])->toBe(['string', 'null']);
});
