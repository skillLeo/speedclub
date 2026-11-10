<?php

namespace App\Http\Controllers\Admin\Config\Support;

use App\Enums\ConfigKey;
use App\Models\Staff;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * ADM-35 rollback (code review SF-3): the key's publish atom on the route, ahead of the recent-password check, so a role without it
 * hears 403 instead of a password prompt. RollbackRequest and the Action check it again.
 */
final class RollbackAtom
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $key = ConfigKey::tryFrom((string) $request->route('key'));
        $staff = $request->user('staff');

        abort_unless($key !== null && $staff instanceof Staff && $staff->can($key->publishAtom()), 403);

        return $next($request);
    }
}
