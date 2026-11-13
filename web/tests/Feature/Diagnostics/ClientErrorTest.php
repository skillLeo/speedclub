<?php

use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;

/**
 * POST /api/v1/client-errors: the app's error screens report what broke, signed in or not; bounded fields, per-IP limit, no
 * personal data in the log beyond the member's id.
 */
function clientReport(array $overrides = []): array
{
    return [
        'route' => '/discover',
        'name' => 'Error',
        'message' => 'Maximum update depth exceeded.',
        'stack' => "Error: Maximum update depth exceeded.\n    at PopularModsChips",
        'component_stack' => "\n    at PopularModsChips\n    at DiscoverScreen",
        'platform' => 'android',
        'app_version' => '1.0.0 (13)',
        'locale' => 'de',
        'font_scale' => 1.15,
        'viewport' => '360x780@2.625',
        'user_agent' => 'Mozilla/5.0 (Linux; Android 14)',
        ...$overrides,
    ];
}

beforeEach(function () {
    RateLimiter::clear('client-errors');
});

it('logs a guest report and answers 204', function () {
    Log::shouldReceive('channel')->once()->with('client')->andReturnSelf();
    Log::shouldReceive('warning')->once()->withArgs(fn (string $message, array $context): bool => str_starts_with($message, 'client error: Maximum update depth')
        && $context['route'] === '/discover' && $context['platform'] === 'android' && $context['member'] === null);

    $this->postJson('/api/v1/client-errors', clientReport())->assertNoContent();
});

it('names a signed-in member by id only', function () {
    $member = User::factory()->create();
    Log::shouldReceive('channel')->once()->with('client')->andReturnSelf();
    Log::shouldReceive('warning')->once()->withArgs(fn (string $message, array $context): bool => $context['member'] === $member->getKey()
        && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), (string) $member->email));

    $this->actingAs($member)->postJson('/api/v1/client-errors', clientReport())->assertNoContent();
});

it('refuses reports without route, message or a known platform, and oversize fields', function (array $overrides, string $field) {
    $this->postJson('/api/v1/client-errors', clientReport($overrides))->assertUnprocessable()->assertJsonValidationErrors($field);
})->with([
    'no route' => [['route' => null], 'route'],
    'no message' => [['message' => ''], 'message'],
    'platform' => [['platform' => 'windows'], 'platform'],
    'long message' => [['message' => str_repeat('x', 2001)], 'message'],
    'long stack' => [['stack' => str_repeat('x', 8001)], 'stack'],
    'viewport' => [['viewport' => '<script>'], 'viewport'],
    'font scale' => [['font_scale' => 9], 'font_scale'],
]);

it('limits reports per IP', function () {
    Log::shouldReceive('channel')->andReturnSelf();
    Log::shouldReceive('warning');
    $max = config()->integer('speedclub.rate_limits.client_errors.max');

    for ($i = 0; $i < $max; $i++) {
        $this->postJson('/api/v1/client-errors', clientReport())->assertNoContent();
    }

    $this->postJson('/api/v1/client-errors', clientReport())->assertTooManyRequests();
});
