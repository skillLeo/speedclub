<?php

/**
 * The M2.1 routes in the export, typed precisely enough that the mobile client needs no hand-written type (05_ARCHITECTURE §7).
 */
it('documents the social graph routes with typed resources and their error bodies', function () {
    $path = tempnam(sys_get_temp_dir(), 'openapi');
    $this->artisan('scramble:export', ['--path' => $path])->assertSuccessful();
    /** @var array<string, mixed> $document */
    $document = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    unlink($path);

    $schemas = $document['components']['schemas'];
    $ref = fn (string $name) => ['$ref' => '#/components/schemas/'.$name];
    $ok = fn (string $path, string $method) => $document['paths'][$path][$method]['responses'][200]['content']['application/json']['schema'];
    $body = fn (string $path, string $method, int $status) => $document['paths'][$path][$method]['responses'][$status]['content']['application/json']['schema'];
    $types = fn (string $schema) => array_map(fn (array $property) => $property['type'] ?? $property['anyOf'] ?? $property['$ref'] ?? null, $schemas[$schema]['properties']);

    expect($document['paths'])->toHaveKeys([
        '/public/users/{username}/followers', '/public/users/{username}/following', '/me/followers/{username}', '/users/{username}/block',
        '/me/blocks', '/vehicles/{vehicle}/save', '/me/saved',
    ])
        ->and($ok('/public/users/{username}/followers', 'get')['properties']['data']['items'])->toBe($ref('ConnectionResource'))
        ->and($ok('/public/users/{username}/followers', 'get')['properties']['meta']['properties'])->toHaveKey('next_cursor')
        ->and($ok('/me/blocks', 'get')['properties']['data']['items'])->toBe($ref('BlockedMemberResource'))
        ->and($ok('/me/saved', 'get')['properties']['data']['items'])->toBe($ref('SavedVehicleResource'))
        ->and($ok('/users/{username}/block', 'post')['properties']['data'])->toBe($ref('BlockStateResource'))
        ->and($ok('/vehicles/{vehicle}/save', 'post')['properties']['data'])->toBe($ref('SaveStateResource'))
        ->and($ok('/me/followers/{username}', 'delete')['properties']['data'])->toBe($ref('FollowerRemovedResource'))
        ->and($types('ConnectionResource'))->toMatchArray(['username' => 'string', 'is_self' => 'boolean', 'is_following' => 'boolean'])
        ->and($types('BlockStateResource'))->toBe(['username' => 'string', 'is_blocked' => 'boolean'])
        ->and($types('SaveStateResource'))->toBe(['vehicle_id' => 'string', 'is_saved' => 'boolean'])
        ->and($types('FollowerRemovedResource'))->toBe(['username' => 'string', 'follows_you' => 'boolean'])
        ->and($types('BlockedMemberResource'))->toMatchArray(['username' => 'string', 'blocked_at' => 'string'])
        ->and($types('SavedVehicleResource'))->toMatchArray(['id' => 'string', 'saved_at' => 'string'])
        ->and($types('MemberProfileResource'))->toMatchArray(['follows_you' => 'boolean', 'can_message' => 'boolean'])
        ->and($types('PublicVehicleResource')['is_saved'])->toBe(['boolean', 'null'])
        ->and($body('/public/users/{username}', 'get', 404))->toBe($ref('MemberUnavailableError'))
        ->and($body('/public/users/{username}/followers', 'get', 404))->toBe($ref('MemberUnavailableError'))
        ->and($schemas['MemberUnavailableError']['properties']['code']['enum'])->toBe(['member_unavailable'])
        ->and($body('/users/{username}/block', 'post', 404))->toBe($ref('MemberUnavailableError'))
        ->and($body('/users/{username}/block', 'post', 422))->toBe($ref('ValidationError'))
        ->and($body('/vehicles/{vehicle}/save', 'post', 404)['anyOf'])->toContain($ref('VehicleUnavailableError'), $ref('FeatureDisabledError'))
        ->and($body('/me/saved', 'get', 404))->toBe($ref('FeatureDisabledError'))
        ->and($schemas['FeatureDisabledError']['properties']['code']['enum'])->toBe(['feature_disabled'])
        ->and(array_column($document['paths']['/users/{username}/block']['post']['parameters'], 'name'))->toContain('Idempotency-Key')
        ->and(array_column($document['paths']['/vehicles/{vehicle}/save']['post']['parameters'], 'name'))->toContain('Idempotency-Key')
        ->and($document['paths']['/public/users/{username}/followers']['get']['security'])->toBe([]);
});
