<?php

namespace App\Http\Controllers\Admin\Errors;

use App\Http\Controllers\Controller;

/**
 * ADM-05 404 for an unknown /admin URL (DQ-507). As the admin group's fallback route it runs inside `web` + `staff`, so the session and
 * the signed-in staff member are known and AdminErrorPage renders the 404 in the shell ("Zum Dashboard"); a guest gets the signed-out
 * variant.
 */
class AdminFallbackController extends Controller
{
    public function __invoke(): never
    {
        abort(404);
    }
}
