<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Services\Audit\Audit;
use App\Services\Setup\SetupToken;
use App\Services\Setup\WebSetup;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * GET|POST /internal/maintenance/{token}/{state} (ADR-539): maintenance mode on or off from the browser, for updates over FTP on
 * a host without SSH: "on" before uploading changed files, "off" if an update is abandoned (the setup switches it off itself).
 * Same token, limit and 404 rules as /internal/setup; reachable in maintenance mode (bootstrap/app.php).
 */
class MaintenanceController extends Controller
{
    public function __invoke(Request $request, string $token, string $state, SetupToken $tokens, WebSetup $setup): Response
    {
        $limited = SetupController::limit($request);
        if ($limited !== null) {
            return $limited;
        }

        if (! $tokens->matches($token)) {
            return SetupController::notFound();
        }

        $down = $state === 'on';
        $ok = $setup->maintenance($down);

        try {
            if (Schema::hasTable('audit_events')) {
                Audit::record('setup.maintenance', after: ['down' => $down, 'ok' => $ok], reason: 'Wartungsmodus im Browser (ADR-539)');
            }
        } catch (Throwable $exception) {
            report($exception);
        }

        return SetupController::page('internal.maintenance', ['down' => $setup->isDown(), 'ok' => $ok], $ok ? 200 : 500);
    }
}
