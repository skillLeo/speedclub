<?php

namespace App\Http\Controllers\Admin\System;

use App\Http\Controllers\Controller;
use App\Services\Audit\Audit;
use App\Support\DevMail\DevMailbox;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\URL;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-61 Mail-Vorschau (09 §8.1): the last 50 outgoing mails of a non-production host whose mail goes to the log mailer, so demos of the
 * e-mail code work without SMTP. Owner only (system.mail_preview, SEC-M46-04). The list carries metadata only (time, recipient,
 * subject), never a body or a code; `?mail=<n>` opens one (its text, and a signed URL of its HTML for the sandboxed frame,
 * MailPreviewFrameController) and every opening is audited (`system.mail_preview_opened`). Refuses in production even if a route existed.
 */
class MailPreviewController extends Controller
{
    /** How long the frame URL of an opened mail stays valid: the frame loads at once; a later reload opens the mail again (audited). */
    private const FRAME_MINUTES = 10;

    public function __invoke(Request $request, DevMailbox $mailbox): Response
    {
        abort_if(app()->isProduction() || ! config()->boolean('speedclub.mail_preview.enabled'), 404);

        $mails = $mailbox->recent(config()->integer('speedclub.mail_preview.limit'));
        $index = $request->integer('mail', -1);

        return Inertia::render('System/MailPreview', [
            'mails' => array_map(fn (array $mail, int $i): array => [
                'index' => $i,
                'at' => $mail['at'],
                'to' => $mail['to'],
                'subject' => self::redact($mail['subject'], $mail['code']),
            ], $mails, array_keys($mails)),
            'selected' => fn (): ?array => isset($mails[$index]) ? $this->open($mails[$index], $index) : null,
            'mailer' => config('mail.default'),
        ]);
    }

    /**
     * @param  array{at: string, to: list<string>, subject: string, html: string, text: string, code: string|null}  $mail
     * @return array{index: int, subject: string, frame: string, text: string}
     */
    private function open(array $mail, int $index): array
    {
        Audit::record('system.mail_preview_opened', after: ['subject' => $mail['subject'], 'to' => $mail['to'], 'sent_at' => $mail['at']]);

        // DQ-1226: the HTML is a document of its own (an srcdoc frame inherits this page's CSP, which blocks the mail's inline styles).
        // Relative, so the frame loads from the origin the admin is open on; only this audited opening hands the URL out.
        $frame = URL::temporarySignedRoute(
            'admin.system.mail-preview.frame',
            now()->addMinutes(self::FRAME_MINUTES),
            ['mail' => $index, 'at' => $mail['at']],
            absolute: false,
        );

        return ['index' => $index, 'subject' => $mail['subject'], 'frame' => $frame, 'text' => $mail['text']];
    }

    /**
     * A code-mail subject names its code ("123456 ist dein Speedclub Code"): the list shows it masked.
     */
    private static function redact(string $subject, ?string $code): string
    {
        $subject = $code !== null && $code !== '' ? str_replace($code, '••••••', $subject) : $subject;

        return (string) preg_replace('/\b\d{6,8}\b/', '••••••', $subject);
    }
}
