<?php

namespace App\Http\Controllers\Staff;

use App\Http\Controllers\Controller;
use Illuminate\Http\Response;

/**
 * POST /admin/session/keep-alive (ADR-217): "Sitzung verlängern" in the idle warning. The session's last activity moves with any
 * request, so the answer only has to exist. The admin sends it only on that click, never in the background.
 */
class SessionKeepAliveController extends Controller
{
    public function __invoke(): Response
    {
        return response()->noContent();
    }
}
