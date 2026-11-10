<?php

use Illuminate\Support\Facades\Log;

it('does not log expected client errors, so anonymous requests cannot fill the disk', function () {
    Log::spy();

    $this->getJson('/api/v1/legal/imprint?version=nope')->assertNotFound();

    Log::shouldNotHaveReceived('error');
});

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    Route::middleware('api')->prefix('api/v1/test')->group(function () {
        Route::get('forbidden', fn () => abort(403));
        Route::get('protected', fn () => response()->noContent())->middleware('auth:sanctum');
        Route::get('crash', fn () => throw new RuntimeException('secret internal detail'));
        Route::get('restricted', fn () => throw new ApiException(ErrorCode::AccountRestricted));
        Route::get('conflict', fn () => throw new ApiException(ErrorCode::Conflict, errors: ['slug' => ['taken']]));
        Route::get('only-get', fn () => response()->noContent());
        Route::post('validate', fn (Request $request) => $request->validate(['email' => ['required', 'email']]));
        Route::get('throttled', fn () => response()->noContent())->middleware('throttle:test-limit');
    });
});

it('renders an unknown API route as JSON 404 in German by default', function () {
    $this->withHeader('Accept-Language', '')
        ->get('/api/v1/does-not-exist')
        ->assertNotFound()
        ->assertJsonPath('message', 'Das haben wir nicht gefunden.')
        ->assertJsonPath('code', 'not_found')
        ->assertJsonPath('errors', []);
});

it('keeps errors a JSON object when it is empty', function () {
    expect($this->get('/api/v1/does-not-exist')->getContent())->toContain('"errors":{}');
});

it('translates errors from Accept-Language', function (string $header, string $message) {
    $this->withHeader('Accept-Language', $header)
        ->get('/api/v1/does-not-exist')
        ->assertNotFound()
        ->assertJsonPath('message', $message);
})->with([
    'en' => ['en', 'We could not find that.'],
    'en region' => ['en-GB,en;q=0.9', 'We could not find that.'],
    'de region' => ['de-DE,de;q=0.9,en;q=0.5', 'Das haben wir nicht gefunden.'],
    'unsupported falls back to de' => ['fr-FR', 'Das haben wir nicht gefunden.'],
]);

it('renders 401, 403 and 405 in the error format', function (string $method, string $uri, int $status, string $code) {
    $this->call($method, $uri)
        ->assertStatus($status)
        ->assertJsonStructure(['message', 'code', 'errors'])
        ->assertJsonPath('code', $code);
})->with([
    ['GET', '/api/v1/test/protected', 401, 'unauthenticated'],
    ['GET', '/api/v1/test/forbidden', 403, 'forbidden'],
    ['POST', '/api/v1/test/only-get', 405, 'method_not_allowed'],
]);

it('renders validation errors with German messages per field', function () {
    $this->withHeader('Accept-Language', 'de')
        ->post('/api/v1/test/validate', ['email' => 'not-an-email'])
        ->assertUnprocessable()
        ->assertJsonPath('code', 'validation_failed')
        ->assertJsonPath('message', 'Bitte prüfe deine Eingaben.')
        ->assertJsonPath('errors.email.0', 'E-Mail-Adresse muss eine gültige E-Mail-Adresse sein.');
});

it('renders validation errors in English on request', function () {
    $this->withHeader('Accept-Language', 'en')
        ->post('/api/v1/test/validate', [])
        ->assertUnprocessable()
        ->assertJsonPath('message', 'Please check your input.')
        ->assertJsonPath('errors.email.0', 'The email field is required.');
});

it('hides internal details of unexpected exceptions', function () {
    $response = $this->get('/api/v1/test/crash')
        ->assertInternalServerError()
        ->assertJsonPath('code', 'server_error');

    expect($response->getContent())->not->toContain('secret internal detail');
});

it('renders domain exceptions with their code and field errors', function () {
    $this->get('/api/v1/test/restricted')
        ->assertForbidden()
        ->assertJsonPath('code', 'account_restricted');

    $this->get('/api/v1/test/conflict')
        ->assertConflict()
        ->assertJsonPath('code', 'conflict')
        ->assertJsonPath('errors.slug.0', 'taken');
});

it('renders rate limiting with Retry-After', function () {
    RateLimiter::for('test-limit', fn () => Limit::perMinute(1));

    $this->get('/api/v1/test/throttled')->assertNoContent();
    $this->get('/api/v1/test/throttled')
        ->assertTooManyRequests()
        ->assertJsonPath('code', 'rate_limited')
        ->assertHeader('Retry-After');
});

it('sets locale headers on successful API responses', function () {
    $this->withHeader('Accept-Language', 'en')
        ->get('/api/v1/test/only-get')
        ->assertNoContent()
        ->assertHeader('Content-Language', 'en');
});

it('leaves non-API errors alone', function () {
    $response = $this->get('/does-not-exist')->assertNotFound();

    expect($response->headers->get('Content-Type'))->toContain('text/html');
});

it('allows the configured SPA origins through CORS with credentials', function (string $origin) {
    $this->withHeaders(['Origin' => $origin, 'Access-Control-Request-Method' => 'GET'])
        ->options('/api/v1/does-not-exist')
        ->assertHeader('Access-Control-Allow-Origin', $origin)
        ->assertHeader('Access-Control-Allow-Credentials', 'true');
})->with(['http://localhost:8081', 'http://localhost:8080']);

it('does not allow other origins through CORS', function () {
    $this->withHeaders(['Origin' => 'https://evil.example', 'Access-Control-Request-Method' => 'GET'])
        ->options('/api/v1/does-not-exist')
        ->assertHeaderMissing('Access-Control-Allow-Origin');
});

it('treats the SPA origins as stateful', function () {
    expect(config('sanctum.stateful'))->toContain('localhost:8080')->toContain('localhost:8081');
});
