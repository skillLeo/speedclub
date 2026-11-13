<?php

namespace App\Http\Controllers\Web;

use App\Enums\QrScanState;
use App\Http\Controllers\Controller;
use App\Http\Middleware\PublicPageContext;
use App\Http\Middleware\RedirectMembersToApp;
use App\Services\Qr\QrResolver;
use App\Services\Qr\QrScans;
use App\Support\PublicUrl;
use App\Support\SignedInBrowser;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * F4: a camera opens /C/{CODE}. Live codes go on to the vehicle's page, everything else gets WEB-06. Never cached, so that a revoked
 * sticker stops working at once and each scan reaches the counter.
 */
class QrScanController extends Controller
{
    private const STATUS = [
        'revoked' => 410,
        'private' => 404,
        'not_found' => 404,
    ];

    public function __invoke(Request $request, string $code, QrResolver $resolver, QrScans $scans): Response
    {
        $member = SignedInBrowser::member($request);
        // While /v keeps signed-in browsers on Blade, it shows them what it shows a guest.
        $resolution = RedirectMembersToApp::enabled() ? $resolver->resolve($code, $member) : $resolver->resolveForGuestPage($code, $member);

        // Screenshot runs are not scans. Production has no overrides, so there every visit counts.
        if (PublicPageContext::qa($request) === null) {
            $scans->record($resolution, $request, $member);
        }

        $response = $resolution->state === QrScanState::Active
            // One hop to the canonical page, on HTTPS where the site is (PublicUrl::absolute): /v answers 200 without another redirect.
            ? redirect()->to(PublicUrl::absolute('/v/'.$resolution->slug()), 302)
            : response()->view('public.state', ['state' => $resolution->state->value, 'copy' => $resolution->copy()], self::STATUS[$resolution->state->value]);

        $response->headers->set('Cache-Control', 'no-store');
        $response->headers->set('X-Robots-Tag', 'noindex');

        return $response;
    }
}
