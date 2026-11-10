<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Services\Qr\QrRenderer;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-04 /app-laden (m2.7-contract §2, 04_SCREEN_REGISTER): where "App laden" and SYS-01's update button lead. Sessionless (ADR-115). The user
 * agent only orders the store buttons, never hides one. A store link that is not configured yet reads "Bald im App Store" / "Bald bei
 * Google Play". On a staging host (speedclub.public_pages.tester_apk_url set) testers get the APK with its SHA-256. A desktop sees a QR
 * code to this page, so the phone opens it.
 */
class GetAppPageController extends Controller
{
    public function __invoke(Request $request, QrRenderer $renderer): Response
    {
        $agent = (string) $request->userAgent();
        $platform = match (true) {
            preg_match('/iPhone|iPad|iPod/i', $agent) === 1 => 'ios',
            preg_match('/Android/i', $agent) === 1 => 'android',
            default => 'desktop',
        };

        $stores = [
            'ios' => self::link(config('speedclub.app_config.links.store_ios')),
            'android' => self::link(config('speedclub.app_config.links.store_android')),
        ];
        $order = $platform === 'android' ? ['android', 'ios'] : ['ios', 'android'];
        $pageUrl = rtrim(config()->string('app.url'), '/').'/app-laden';
        $apk = self::link(config('speedclub.public_pages.tester_apk_url'));
        $sha = config('speedclub.public_pages.tester_apk_sha256');

        return response()->view('public.get-app', [
            'platform' => $platform,
            'stores' => array_map(fn (string $store): array => ['key' => $store, 'url' => $stores[$store]], $order),
            'qr' => $platform === 'desktop' ? 'data:image/svg+xml;base64,'.base64_encode($renderer->svg($pageUrl)) : null,
            'pageUrl' => $pageUrl,
            'apk' => $apk === null ? null : ['url' => $apk, 'sha256' => is_string($sha) && preg_match('/^[a-f0-9]{64}$/i', $sha) === 1 ? strtolower($sha) : null],
        ]);
    }

    /**
     * Only an absolute https or http address counts as configured.
     */
    private static function link(mixed $value): ?string
    {
        return is_string($value) && preg_match('#^https?://\S+$#i', trim($value)) === 1 ? trim($value) : null;
    }
}
