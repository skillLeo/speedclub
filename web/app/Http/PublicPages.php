<?php

namespace App\Http;

use App\Http\Middleware\RefuseLongQuery;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;

/**
 * Public Blade pages (WEB-01, 02, 03, 06, 08 and the later WEB-*) serve guests without a session: no cookie and no row
 * with an IP address and a user agent (08_LEGAL_COMPLIANCE §1, ADR-115). Cookie encryption stays, so a page can still
 * recognise a signed-in visitor by reading the existing cookie. Pages with a form need their own CSRF decision.
 *
 * RefuseLongQuery goes with the session: it only protects the session row, and a long campaign link should reach the page.
 */
final class PublicPages
{
    public const WITHOUT_SESSION = [
        StartSession::class,
        ShareErrorsFromSession::class,
        PreventRequestForgery::class,
        RefuseLongQuery::class,
    ];
}
