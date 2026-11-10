<?php

namespace App\Http\Controllers\Admin\Memberships;

use App\Services\Memberships\Memberships;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * ADM-F1/F2 while `premium.enabled` is off: 404 for everyone, before the atom is asked (06 §3: the scaffold does not exist then).
 */
class EnsureMembershipsEnabled
{
    public function __construct(private readonly Memberships $memberships) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $this->memberships->ensureEnabled();

        return $next($request);
    }
}
