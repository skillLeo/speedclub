<?php

use App\Exceptions\ApiException;
use App\Http\RateLimits;
use App\Models\User;
use App\Services\Auth\LoginThrottle;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

/**
 * The limit a limiter applies first: search and browse add a ceiling per address after it.
 */
function firstLimit(mixed $limits): Limit
{
    $limit = is_array($limits) ? $limits[0] : $limits;
    expect($limit)->toBeInstanceOf(Limit::class);

    return $limit;
}

it('defines every limit of the product spec', function (string $limiter, int $max, int $seconds) {
    $limit = firstLimit(RateLimiter::limiter($limiter)(Request::create('/')));

    expect($limit->maxAttempts)->toBe($max)
        ->and($limit->decaySeconds)->toBe($seconds);
})->with([
    'registration 5 per hour' => ['member-register', 5, 3600],
    'login 10 per minute' => ['member-login', 10, 60],
    'conversations 20 per day' => ['conversations', 20, 86400],
    'requests 10 per day' => ['conversation-requests', 10, 86400],
    'messages 30 per minute' => ['messages', 30, 60],
    'follows 200 per day' => ['follows', 200, 86400],
    'uploads 60 per hour' => ['uploads', 60, 3600],
    'reports 20 per day' => ['reports', 20, 86400],
    'search 60 per minute' => ['search', 60, 60],
    'QR resolver 120 per minute' => ['qr', 120, 60],
    'public reads 300 per minute' => ['public-read', 300, 60],
]);

it('counts per IP for the anonymous limits', function (string $limiter) {
    $from = fn (string $ip) => RateLimiter::limiter($limiter)(Request::create('/', 'GET', server: ['REMOTE_ADDR' => $ip]))->key;

    expect($from('203.0.113.1'))->toBe($from('203.0.113.1'))
        ->and($from('203.0.113.1'))->not->toBe($from('203.0.113.2'));
})->with(['member-register', 'member-login', 'qr', 'public-read']);

it('counts per member and per IP for guests on the others', function () {
    $requestFor = function (?User $user): Request {
        $request = Request::create('/', 'GET', server: ['REMOTE_ADDR' => '203.0.113.1']);
        $request->setUserResolver(fn () => $user);

        return $request;
    };

    $limiter = RateLimiter::limiter('search');
    [$one, $two] = User::factory()->count(2)->create();

    $key = fn (?User $user): string => firstLimit($limiter($requestFor($user)))->key;

    expect($key($one))->toContain($one->id)
        ->and($key($one))->not->toBe($key($two))
        ->and($key(null))->toContain('203.0.113.1');
});

it('bounds search per address across every account behind it, below the browse ceiling', function () {
    $limits = RateLimiter::limiter('search')(Request::create('/', 'GET', server: ['REMOTE_ADDR' => '203.0.113.1']));

    expect($limits)->toBeArray()->toHaveCount(2)
        ->and($limits[1]->maxAttempts)->toBe(240)
        ->and($limits[1]->decaySeconds)->toBe(60)
        ->and($limits[1]->key)->toBe('search|address|ip:203.0.113.1')
        ->and($limits[1]->maxAttempts)->toBeLessThan(config()->integer('speedclub.rate_limits.browse.ip_max'));
});

it('words the wait in seconds when less than a minute is left', function (string $locale, string $wording) {
    $this->freezeTime();
    Route::middleware(['api', 'throttle:member-login'])->post('api/v1/test/login', fn () => response()->noContent());

    for ($i = 0; $i < 10; $i++) {
        $this->postJson('/api/v1/test/login')->assertNoContent();
    }

    $this->travel(30)->seconds();

    $response = $this->withHeader('Accept-Language', $locale)->postJson('/api/v1/test/login')->assertTooManyRequests();

    expect($response->json('message'))->toContain($wording)
        ->and($response->headers->get('Retry-After'))->toBe('30');
})->with([
    'de' => ['de', '30 Sekunden'],
    'en' => ['en', '30 seconds'],
]);

it('answers a friendly 429 in both languages with Retry-After', function (string $locale, string $message, string $unit) {
    // The wording depends on the seconds left: the clock must not tick during the requests.
    $this->freezeTime();
    Route::middleware(['api', 'throttle:member-login'])->post('api/v1/test/login', fn () => response()->noContent());

    for ($i = 0; $i < 10; $i++) {
        $this->postJson('/api/v1/test/login')->assertNoContent();
    }

    $response = $this->withHeader('Accept-Language', $locale)
        ->postJson('/api/v1/test/login')
        ->assertTooManyRequests()
        ->assertJsonPath('code', 'rate_limited')
        ->assertJsonPath('errors', []);

    expect((int) $response->headers->get('Retry-After'))->toBeGreaterThan(0)->toBeLessThanOrEqual(60)
        ->and($response->json('message'))->toContain($message)->toContain($unit)
        ->and($response->headers->get('X-RateLimit-Limit'))->toBe('10');
})->with([
    'de' => ['de', 'Zu viele Anmeldeversuche', 'Minute'],
    'en' => ['en', 'Too many sign-in attempts', 'minute'],
]);

it('has a message for every limiter in both languages', function (string $key) {
    foreach (['de', 'en'] as $locale) {
        expect(trans('rate_limits.'.$key, [], $locale))->not->toBe('rate_limits.'.$key);
    }
})->with(['member_register', 'member_login', 'login_delay', 'conversations', 'conversation_requests', 'messages', 'follows', 'uploads', 'reports', 'search', 'qr', 'catalog_requests']);

it('throttles a member independently of others', function () {
    config(['speedclub.rate_limits.search.max' => 1]);
    RateLimits::register();
    Route::middleware(['api', 'auth:sanctum', 'throttle:search'])->get('api/v1/test/search', fn () => response()->noContent());

    Sanctum::actingAs(User::factory()->create());
    $this->getJson('/api/v1/test/search')->assertNoContent();
    $this->getJson('/api/v1/test/search')->assertTooManyRequests();

    Sanctum::actingAs(User::factory()->create());
    $this->getJson('/api/v1/test/search')->assertNoContent();
});

describe('progressive login delay', function () {
    beforeEach(function () {
        $this->throttle = app(LoginThrottle::class);
    });

    it('allows the first failures without any delay', function () {
        for ($i = 0; $i < 4; $i++) {
            $this->throttle->recordFailure('a@example.test');
            expect($this->throttle->secondsUntilAllowed('a@example.test'))->toBe(0);
        }

        $this->throttle->ensureAllowed('a@example.test');
    });

    it('starts after 5 failures and grows up to the maximum, never locking out for good', function () {
        $delays = [];

        for ($i = 1; $i <= 12; $i++) {
            $this->throttle->recordFailure('a@example.test');
            $delays[$i] = $this->throttle->secondsUntilAllowed('a@example.test');
        }

        expect($delays[4])->toBe(0)
            ->and($delays[5])->toBeBetween(1, 2)
            ->and($delays[6])->toBeBetween(3, 4)
            ->and($delays[7])->toBeBetween(7, 8)
            ->and($delays[12])->toBeBetween(59, 60);
    });

    it('answers 429 with Retry-After while the delay runs', function () {
        for ($i = 0; $i < 5; $i++) {
            $this->throttle->recordFailure('a@example.test');
        }

        try {
            $this->throttle->ensureAllowed('a@example.test');
            $this->fail('Expected an exception.');
        } catch (ApiException $exception) {
            expect($exception->errorCode->status())->toBe(429)
                ->and((int) $exception->headers['Retry-After'])->toBeGreaterThan(0)
                ->and($exception->getMessage())->not->toContain('rate_limits');
        }
    });

    it('releases after the delay', function () {
        for ($i = 0; $i < 5; $i++) {
            $this->throttle->recordFailure('a@example.test');
        }

        $this->travel(3)->seconds();

        expect($this->throttle->secondsUntilAllowed('a@example.test'))->toBe(0);
    });

    it('counts per account, ignoring case and spaces', function () {
        for ($i = 0; $i < 5; $i++) {
            $this->throttle->recordFailure('A@Example.test ');
        }

        expect($this->throttle->secondsUntilAllowed('a@example.test'))->toBeGreaterThan(0)
            ->and($this->throttle->secondsUntilAllowed('b@example.test'))->toBe(0);
    });

    it('starts over after a successful login', function () {
        for ($i = 0; $i < 6; $i++) {
            $this->throttle->recordFailure('a@example.test');
        }

        $this->throttle->clear('a@example.test');

        expect($this->throttle->secondsUntilAllowed('a@example.test'))->toBe(0);

        $this->throttle->recordFailure('a@example.test');

        expect($this->throttle->secondsUntilAllowed('a@example.test'))->toBe(0);
    });
});
