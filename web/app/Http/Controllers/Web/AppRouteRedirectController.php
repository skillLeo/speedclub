<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * An app-link path the installed app claims (PlatformFilesController::APP_PATHS), opened in a browser without the app: the same screen
 * of the member web under /app, with the query string kept (Route::redirect drops it). Only routes with a fixed path use this, so the
 * target is always this origin's /app plus that path.
 */
class AppRouteRedirectController extends Controller
{
    public function __invoke(Request $request): RedirectResponse
    {
        $query = $request->getQueryString();

        return redirect()->to('/app'.$request->getPathInfo().($query === null ? '' : '?'.$query), 302);
    }
}
