<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Services\Setup\SetupToken;
use App\Services\Setup\WebSetup;
use App\Support\ClientAddress;
use Illuminate\Cache\RateLimiter;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * GET|POST /internal/setup/{token} (ADR-539): the web installer of a host without SSH (DEPLOY_ALLINKL.md). GET shows the state
 * and one button; POST runs WebSetup and shows the result. After a successful run the token is spent (SetupToken): the page
 * answers 404 until .env carries a new SETUP_TOKEN.
 *
 * - No token, a short one, a spent one or a wrong one: 404, as if the route did not exist; compared in constant time.
 * - Every request counts against the per-address limit, on the file cache (no cache table before the first migration).
 * - No session and no cookie middleware (APP_KEY may still be empty), reachable in maintenance mode (bootstrap/app.php). Answers
 *   are built directly, never through response() or abort(): those resolve the redirector and with it the (encrypted) session
 *   store, which fails while APP_KEY is empty (found by scripts/dev/allinkl-flow-test.sh).
 * The token is in the URL and so in the host's access log: it is spent after use anyway.
 */
class SetupController extends Controller
{
    public function __invoke(Request $request, string $token, SetupToken $tokens, WebSetup $setup): Response
    {
        $limited = self::limit($request);
        if ($limited !== null) {
            return $limited;
        }

        if (! $tokens->matches($token)) {
            return self::notFound();
        }

        $result = null;
        $status = 200;

        if ($request->isMethod('post')) {
            $result = $setup->run();
            if ($result === null) {
                $result = ['ok' => false, 'lines' => ['Die Einrichtung läuft gerade schon. Bitte eine Minute warten und die Seite neu laden.'], 'fresh' => false];
                $status = 409;
            } elseif ($result['ok']) {
                $tokens->spend($token);
            }
        }

        return self::page('internal.setup', [
            'result' => $result,
            'down' => $setup->isDown(),
            'database' => $this->database($setup),
            'package' => $this->package(),
        ], $status);
    }

    /** The shared per-address limit of the setup and maintenance pages; null when the request may go on. */
    public static function limit(Request $request): ?Response
    {
        $limiter = new RateLimiter(Cache::store('file'));
        $key = 'setup-url|'.ClientAddress::key($request);
        if ($limiter->tooManyAttempts($key, config()->integer('speedclub.setup.max_per_minute'))) {
            return new Response('', 429, ['Retry-After' => (string) max(1, $limiter->availableIn($key)), 'Cache-Control' => 'no-store']);
        }
        $limiter->hit($key, 60);

        return null;
    }

    /**
     * @param  view-string  $view
     * @param  array<string, mixed>  $data
     */
    public static function page(string $view, array $data, int $status): Response
    {
        return new Response(view($view, $data)->render(), $status, ['Content-Type' => 'text/html; charset=UTF-8', ...self::headers()]);
    }

    /** As if the route did not exist; plain text, because the error page would need the session (see above). */
    public static function notFound(): Response
    {
        return new Response('Not Found', 404, ['Content-Type' => 'text/plain; charset=UTF-8', ...self::headers()]);
    }

    /** @return array<string, string> */
    public static function headers(): array
    {
        return ['Cache-Control' => 'no-store', 'X-Robots-Tag' => 'noindex, nofollow'];
    }

    /** @return array{state: string, detail: string} */
    private function database(WebSetup $setup): array
    {
        try {
            return $setup->databaseIsEmpty()
                ? ['state' => 'empty', 'detail' => 'leer: die Einrichtung legt die Grunddaten an (Erstinstallation)']
                : ['state' => 'existing', 'detail' => 'vorhanden: die Einrichtung ergänzt nur Neues (Update)'];
        } catch (Throwable $exception) {
            return ['state' => 'error', 'detail' => 'nicht erreichbar, bitte DB_HOST, DB_DATABASE, DB_USERNAME, DB_PASSWORD in .env prüfen ('.strtok($exception->getMessage(), "\n").')'];
        }
    }

    /** @return list<string> */
    private function package(): array
    {
        $file = base_path('PACKAGE_INFO.txt');
        if (! is_file($file)) {
            return [];
        }

        return array_slice(array_values(array_filter(array_map(trim(...), file($file) ?: []))), 0, 3);
    }
}
