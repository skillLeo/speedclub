<?php

use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\Route;

/**
 * M2.2 routes in the export, and a guard for every list: the item schema of each route that returns `X::collection(...)` is X. Scramble once
 * typed ConnectionResource::collection() as a page of its parent MemberSummaryResource after another resource called the parent's
 * collection(); the mobile types then lost is_self and is_following without any PHP change.
 */
function homeOpenApiDocument(): array
{
    $path = tempnam(sys_get_temp_dir(), 'openapi');
    test()->artisan('scramble:export', ['--path' => $path])->assertSuccessful();
    $document = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    unlink($path);

    return $document;
}

it('documents each collection route with the item schema of the resource it returns', function () {
    $document = homeOpenApiDocument();
    $checked = [];
    $wrong = [];

    foreach (Route::getRoutes()->getRoutes() as $route) {
        /** @var LaravelRoute $route */
        $action = $route->getActionName();

        if (! str_starts_with($route->uri(), 'api/v1/') || ! str_contains($action, '@')) {
            continue;
        }

        [$class, $method] = explode('@', $action);
        $reflection = new ReflectionMethod($class, $method);
        $lines = array_slice(file((string) $reflection->getFileName()) ?: [], $reflection->getStartLine() - 1, $reflection->getEndLine() - $reflection->getStartLine() + 1);

        if (preg_match_all('/return\s+(\w+Resource)::collection\(/', implode('', $lines), $matches) !== 1) {
            continue;
        }

        $path = '/'.substr($route->uri(), strlen('api/v1/'));
        $verb = strtolower($route->methods()[0]);
        $items = $document['paths'][$path][$verb]['responses'][200]['content']['application/json']['schema']['properties']['data']['items'] ?? null;
        $expected = ['$ref' => '#/components/schemas/'.$matches[1][0]];
        $checked[] = "$verb $path";
        // A resource whose fields depend on loaded relations comes as allOf: [the schema, {required: […]}].
        $schema = $items['allOf'][0] ?? $items;

        if ($schema !== $expected) {
            $wrong[] = "$verb $path: ".json_encode($items).' instead of '.$matches[1][0];
        }
    }

    expect(count($checked))->toBeGreaterThan(10)
        ->and($checked)->toContain('get /public/users/{username}/followers', 'get /notifications', 'get /home/new-builds')
        ->and($wrong)->toBe([]);
});

it('documents the M2.2 routes with typed resources', function () {
    $document = homeOpenApiDocument();
    $schemas = $document['components']['schemas'];
    $ref = fn (string $name) => ['$ref' => '#/components/schemas/'.$name];
    $ok = fn (string $path, string $method) => $document['paths'][$path][$method]['responses'][200]['content']['application/json']['schema'];
    $types = fn (string $schema) => array_map(fn (array $property) => $property['type'] ?? $property['anyOf'] ?? $property['$ref'] ?? null, $schemas[$schema]['properties']);

    expect($ok('/feed', 'get'))->toBe($ref('FeedPageResource'))
        ->and($schemas['FeedPageResource']['properties']['data']['items'])->toBe($ref('FeedItemResource'))
        ->and($schemas['FeedPageResource']['properties']['meta']['properties'])->toHaveKeys(['next_cursor', 'per_page', 'suggestions'])
        ->and($schemas['FeedPageResource']['properties']['meta']['properties']['suggestions']['items'])->toBe($ref('ActiveMemberResource'))
        ->and($types('FeedItemResource'))->toMatchArray(['type' => '#/components/schemas/FeedItemType', 'key' => 'string'])
        ->and($ok('/home/modules', 'get')['properties']['data'])->toBe($ref('HomeModulesResource'))
        ->and($schemas['HomeModulesResource']['properties']['build_updates']['items'])->toBe($ref('BuildUpdateRowResource'))
        ->and($schemas['HomeModulesResource']['properties']['active_members']['items'])->toBe($ref('ActiveMemberResource'))
        ->and($schemas['HomeModulesResource']['properties']['popular_mods']['items'])->toBe($ref('PopularModResource'))
        ->and($types('ActiveMemberResource'))->toMatchArray(['username' => 'string', 'car_line' => ['string', 'null'], 'car_short' => ['string', 'null'], 'is_following' => 'boolean'])
        ->and($types('PopularModResource'))->toBe(['label' => 'string', 'category_key' => ['string', 'null'], 'query' => 'string'])
        ->and($types('BuildUpdateRowResource'))->toMatchArray(['id' => 'string', 'vehicle' => '#/components/schemas/FeedVehicleResource', 'summary' => 'string'])
        ->and($schemas['NotificationResource']['properties']['actors']['items'])->toBe($ref('MemberSummaryResource'))
        ->and($types('NotificationResource'))->toMatchArray(['id' => 'string', 'actor_count' => 'integer', 'group_key' => ['string', 'null']])
        ->and($schemas['NotificationType']['enum'])->toBe(['new_follower', 'followed_published', 'build_saved', 'security', 'moderation_decision', 'report_decided', 'qr_milestone', 'hu_au_reminder', 'catalog_request', 'support_reply'])
        ->and($ok('/notifications/unread-count', 'get')['properties']['data'])->toBe($ref('UnreadCountResource'))
        ->and($types('UnreadCountResource'))->toBe(['notifications' => 'integer', 'messages' => 'integer', 'requests' => 'integer'])
        ->and($ok('/notifications/{notification}', 'patch')['properties']['data'])->toBe($ref('NotificationResource'))
        ->and($document['paths']['/notifications/read-all']['post']['responses'])->toHaveKey(204)
        ->and($document['paths']['/me/push-tokens']['post']['responses'])->toHaveKey(204)
        ->and($document['paths']['/me/push-tokens/{deviceId}']['delete']['responses'])->toHaveKey(204)
        ->and(array_column($document['paths']['/me/push-tokens']['post']['parameters'], 'name'))->toContain('Idempotency-Key')
        ->and($schemas['MemberSettingsResource']['properties']['notification_prefs']['properties'])->toHaveKeys(['types', 'quiet_hours', 'message_previews'])
        ->and($document['paths']['/feed']['get']['security'])->toBe([])
        ->and($document['paths']['/feed']['get']['responses'][409]['content']['application/json']['schema'])->toBe($ref('FeedStaleError'))
        ->and($schemas['FeedStaleError']['properties']['code']['enum'])->toBe(['feed_stale'])
        ->and($schemas['BlockedMemberResource']['properties'])->toHaveKeys(['username', 'blocked_at'])->not->toHaveKey('display_name');
});
