<?php

namespace App\Http\Controllers\Admin\System;

use App\Http\Controllers\Controller;
use App\Support\DevMail\DevMailbox;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * ADM-61 Mail-Vorschau, the opened mail's HTML as its own document for the page's frame (DQ-1226). An `srcdoc` frame inherits the admin
 * page's CSP, which blocks the mail's inline styles, so the preview showed an unstyled page instead of the mail as sent. This answer
 * carries a CSP of its own: no scripts at all, inline styles, images of this host, framed only by the admin itself, and the `sandbox`
 * directive, so even opened on its own it runs nothing and has no origin.
 *
 * The URL is temporary and signed (relative), and only an audited opening hands one out (MailPreviewController::open, SEC-M46-04),
 * so every body read follows a `system.mail_preview_opened` row; the route also needs the Owner atom. `at` names the mail the
 * signature was issued for: when a newer mail has moved the list in between, the frame answers 404 instead of showing another mail.
 */
class MailPreviewFrameController extends Controller
{
    public function __invoke(Request $request, DevMailbox $mailbox, int $mail): Response
    {
        abort_if(app()->isProduction() || ! config()->boolean('speedclub.mail_preview.enabled'), 404);

        $mails = $mailbox->recent(config()->integer('speedclub.mail_preview.limit'));
        abort_unless(isset($mails[$mail]) && $mails[$mail]['at'] === $request->query('at'), 404);

        return response($mails[$mail]['html'], 200, [
            'Content-Type' => 'text/html; charset=utf-8',
            'Content-Security-Policy' => self::policy(),
            // SecurityHeaders keeps this one SAMEORIGIN (every other answer is DENY); frame-ancestors says the same for current browsers.
            'X-Frame-Options' => 'SAMEORIGIN',
            'Cache-Control' => 'private, no-store, max-age=0',
            'Referrer-Policy' => 'no-referrer',
        ]);
    }

    private static function policy(): string
    {
        // The mails link their images (the logo) absolutely, on APP_URL's origin, which need not be the origin the admin is opened on.
        $app = parse_url(config()->string('app.url'));
        $appOrigin = isset($app['scheme'], $app['host']) ? $app['scheme'].'://'.$app['host'].(isset($app['port']) ? ':'.$app['port'] : '') : '';

        return implode('; ', [
            "default-src 'none'",
            "style-src 'unsafe-inline'",
            trim("img-src 'self' data: {$appOrigin}"),
            "font-src 'self' data:",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'self'",
            'sandbox',
        ]);
    }
}
