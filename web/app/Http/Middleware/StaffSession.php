<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Auth\AuthManager;
use Illuminate\Http\Request;
use Illuminate\Session\SessionManager;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gives /admin its own session cookie and makes "staff" the default guard.
 * Must run before StartSession; bootstrap/app.php pins that through the middleware priority list.
 *
 * Every staff answer is no-store: TOTP keys, QR codes and recovery codes (SEC-P1-28), and every admin page with member data, must
 * never land in a browser's disk cache.
 */
class StaffSession
{
    public function __construct(
        private readonly SessionManager $sessions,
        private readonly AuthManager $auth,
    ) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        config([
            'session.cookie' => config('speedclub.staff.session_cookie'),
            'session.path' => config('speedclub.staff.session_path'),
            'session.lifetime' => config('speedclub.staff.session_lifetime'),
            // Garbage collection would apply the 30 minutes above to every row, members' too (SEC-P1-44). Other requests still collect.
            'session.lottery' => [0, 100],
        ]);

        // The store may already exist (console kernels, tests); its name must follow the config.
        $this->sessions->driver()->setName(config()->string('session.cookie'));

        $this->auth->shouldUse('staff');

        $response = $next($request);
        $response->headers->set('Cache-Control', 'no-store, private');

        return $response;
    }
}
