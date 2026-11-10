<?php

use App\Http\BoundedRequest;
use App\Http\Middleware\LimitJsonBody;
use App\Models\User;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Inertia\Middleware\EnsureDeferredCallbacksRun;
use Laravel\Sanctum\Sanctum;
use Symfony\Component\HttpFoundation\Request as SymfonyRequest;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Process\Process;

/**
 * SEC-P1-46 and SEC-P1-48: a JSON body over 512 KB is refused ahead of everything that decodes it. Request::capture() decodes in the
 * front controller, TrimStrings on every route, and both come before routing, the session and the limiters. The tests run through
 * the kernel, not through public/index.php, so the live half of the proof is in docs/reports/security/phase-1.md, under SEC-P1-48.
 */

/** A JSON body of exactly $bytes bytes. */
function jsonBodyOf(int $bytes): string
{
    return '{"a":"'.str_repeat('a', $bytes - 8).'"}';
}

/**
 * @param  array<string, string>  $headers  In $_SERVER form.
 * @return TestResponse<Response>
 */
function sendJsonBody(string $method, string $uri, string $body, array $headers = []): TestResponse
{
    return test()->call($method, $uri, [], [], [], ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => (string) strlen($body), ...$headers], $body);
}

describe('the limit on a JSON body', function () {
    it('sits at the very front of the global middleware', function () {
        // Inertia's provider prepends this one while it boots. It only looks at the response.
        $global = array_diff(app(Kernel::class)->getGlobalMiddleware(), [EnsureDeferredCallbacksRun::class]);

        expect(array_values($global)[0])->toBe(LimitJsonBody::class);
    });

    it('draws the line at 512 KB, on a route that reads nothing', function (int $bytes, int $status) {
        sendJsonBody('GET', '/up', jsonBodyOf($bytes))->assertStatus($status);
    })->with([
        'at the line' => [524288, 200],
        'one byte above' => [524289, 413],
    ]);

    it('answers on any route, ahead of routing, the session and the limiters', function (string $method, string $uri) {
        sendJsonBody($method, $uri, jsonBodyOf(1100000), ['HTTP_ACCEPT' => 'application/json'])
            ->assertStatus(413)
            ->assertJsonPath('code', 'payload_too_large');
    })->with([
        'health' => ['GET', '/up'],
        'member login, SEC-P1-46' => ['POST', '/api/v1/auth/login'],
        'member registration, SEC-P1-46' => ['POST', '/api/v1/auth/register'],
        'staff sign-in' => ['POST', '/admin/login'],
        'no such route' => ['POST', '/nope'],
    ]);

    it('answers every JSON type the framework would decode, and no other', function (string $type, int $status) {
        sendJsonBody('GET', '/up', jsonBodyOf(1100000), ['CONTENT_TYPE' => $type])->assertStatus($status);
    })->with([
        'with a charset' => ['application/json; charset=utf-8', 413],
        'a vendor type' => ['application/vnd.api+json', 413],
        'text' => ['text/json', 413],
        'plain text, nothing decodes it' => ['text/plain', 200],
    ]);

    it('answers a body sent without a Content-Length, as a chunked one arrives', function () {
        $body = jsonBodyOf(524289);

        $this->call('GET', '/up', [], [], [], ['CONTENT_TYPE' => 'application/json'], $body)->assertStatus(413);
        $this->call('GET', '/up', [], [], [], ['CONTENT_TYPE' => 'application/json'], jsonBodyOf(524288))->assertOk();
    });

    it('never reads further than the line when no length is declared', function () {
        $stream = fopen('php://temp', 'r+');
        fwrite($stream, jsonBodyOf(1048576));

        $request = Request::create('/x', 'POST', [], [], [], ['CONTENT_TYPE' => 'application/json'], $stream);

        expect(LimitJsonBody::exceeds($request))->toBeTrue()
            ->and(ftell($stream))->toBe(524289);
    });

    // At the 256M that docs/DEPLOY.md asks of a host. At 1 MB these ran out of memory in the validator and answered an empty 500.
    it('answers a nested body up to the line under the memory limit of a host', function (int $depth) {
        $process = new Process(
            [PHP_BINARY, '-d', 'memory_limit=256M', '-d', 'display_errors=0', __DIR__.'/Fixtures/json-body-at-the-line.php', (string) $depth],
            base_path(),
            ['APP_ENV' => 'testing', 'APP_DEBUG' => 'false', 'DB_DATABASE' => config()->string('database.connections.mysql.database'), 'CACHE_STORE' => 'array', 'SESSION_DRIVER' => 'array', 'LOG_CHANNEL' => 'null'],
            null,
            120,
        );

        $process->run();

        expect($process->getExitCode())->toBe(0)
            ->and($process->getOutput())->toBe('422');
    })->with(['flat' => 1, 'three levels' => 3, 'twenty levels' => 20]);

    it('answers a client that expects JSON in the error format, in its language', function (string $language, string $message) {
        $response = sendJsonBody('POST', '/admin/login', jsonBodyOf(1100000), ['HTTP_ACCEPT' => 'application/json', 'HTTP_ACCEPT_LANGUAGE' => $language]);

        $response->assertStatus(413)->assertExactJson(['message' => $message, 'code' => 'payload_too_large', 'errors' => []]);

        expect($response->getContent())->toContain('"errors":{}');
    })->with([
        'de' => ['de', 'Die Datei oder Anfrage ist zu groß.'],
        'en' => ['en', 'The file or request is too large.'],
    ]);

    it('counts an XHR that accepts anything as a JSON client', function () {
        sendJsonBody('POST', '/admin/login', jsonBodyOf(1100000), ['HTTP_X_REQUESTED_WITH' => 'XMLHttpRequest', 'HTTP_ACCEPT' => '*/*'])
            ->assertStatus(413)
            ->assertJsonPath('code', 'payload_too_large');
    });

    it('answers in the error format on the API, whatever the client accepts', function (string $accept) {
        sendJsonBody('POST', '/api/v1/auth/login', jsonBodyOf(1100000), ['HTTP_ACCEPT' => $accept])
            ->assertStatus(413)
            ->assertJsonPath('code', 'payload_too_large');
    })->with(['anything' => '*/*', 'a browser' => 'text/html']);

    it('answers a browser in plain text', function () {
        $response = sendJsonBody('POST', '/admin/login', jsonBodyOf(1100000), ['HTTP_ACCEPT' => 'text/html', 'HTTP_ACCEPT_LANGUAGE' => 'en']);

        $response->assertStatus(413);

        expect($response->getContent())->toBe('The file or request is too large.')
            ->and($response->headers->get('Content-Type'))->toStartWith('text/plain');
    });

    it('stores nothing and spends no limit', function () {
        config(['session.driver' => 'database']);
        app('session')->forgetDrivers();
        app()->forgetInstance('session.store');

        foreach (range(1, 12) as $ignored) {
            sendJsonBody('POST', '/api/v1/auth/login', (string) json_encode(['email' => 'x@example.org', 'password' => 'x', 'junk' => str_repeat('a', 1100000)]), ['HTTP_ACCEPT' => 'application/json'])
                ->assertStatus(413);
        }

        expect(DB::table('sessions')->count())->toBe(0);

        $this->postJson('/api/v1/auth/login', ['email' => 'x@example.org', 'password' => 'a-wrong-password', 'device_name' => 'P'])->assertUnauthorized();
    });

    it('leaves a form alone, and a multipart body of any declared length', function () {
        $this->call('GET', '/up', [], [], [], ['CONTENT_TYPE' => 'multipart/form-data; boundary=x', 'CONTENT_LENGTH' => '5000000'])->assertOk();
        $this->call('GET', '/up', [], [], [], ['CONTENT_TYPE' => 'application/x-www-form-urlencoded', 'CONTENT_LENGTH' => '5000000'])->assertOk();
    });

    it('lets a real photo upload over 1 MB through', function () {
        Storage::fake('public');
        Storage::fake('local');
        Sanctum::actingAs(User::factory()->create());

        $image = imagecreatetruecolor(1600, 1200);

        // Noise compresses badly, so the JPEG is over the line while staying small enough for the endpoint.
        for ($y = 0; $y < 1200; $y += 2) {
            for ($x = 0; $x < 1600; $x += 2) {
                imagefilledrectangle($image, $x, $y, $x + 1, $y + 1, random_int(0, 0xFFFFFF));
            }
        }

        ob_start();
        imagejpeg($image, null, 95);
        $jpeg = (string) ob_get_clean();

        expect(strlen($jpeg))->toBeGreaterThan(1048576);

        $this->withServerVariables(['CONTENT_TYPE' => 'multipart/form-data; boundary=x', 'CONTENT_LENGTH' => (string) strlen($jpeg)])
            ->post('/api/v1/me/avatar', ['file' => UploadedFile::fake()->createWithContent('a.jpg', $jpeg)], ['Accept' => 'application/json'])
            ->assertOk();
    });
});

describe('capturing a request in the front controller', function () {
    $capture = fn (string $body): BoundedRequest => BoundedRequest::createFromBase(
        SymfonyRequest::create('/x', 'POST', [], [], [], ['CONTENT_TYPE' => 'application/json', 'CONTENT_LENGTH' => (string) strlen($body)], $body),
    );

    it('does not decode a body over the line', function () use ($capture) {
        $request = $capture('["'.str_repeat('a', 524288).'"]');

        expect($request->request->all())->toBe([])
            ->and($request->json()->all())->toBe([])
            ->and(LimitJsonBody::exceeds($request))->toBeTrue();
    });

    it('decodes a body up to the line', function () use ($capture) {
        $request = $capture(jsonBodyOf(524288));

        expect(strlen((string) $request->input('a')))->toBe(524280)
            ->and(LimitJsonBody::exceeds($request))->toBeFalse();
    });

    it('is what public/index.php captures', function () {
        expect((string) file_get_contents(public_path('index.php')))->toContain('$app->handleRequest(BoundedRequest::capture());');
    });
});
