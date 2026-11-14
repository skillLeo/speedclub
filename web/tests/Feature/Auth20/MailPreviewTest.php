<?php

use App\Models\AuditEvent;
use App\Support\DevMail\DevMailbox;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use Symfony\Component\Process\Process;

require_once __DIR__.'/Helpers.php';
require_once __DIR__.'/../Admin/M36/Helpers.php';

/**
 * ADM-61 Mail-Vorschau (09 §8.1): the Owner (system.mail_preview, SEC-M46-04) sees the last 50 outgoing mails outside production as
 * metadata; a mail's body loads on its own (audited); the page does not exist in production.
 */
beforeEach(function () {
    Storage::fake('local');
    config(['speedclub.email_code.min_response_ms' => 0]);
});

it('guards the page by role', function () {
    assertAdminMatrix('GET', '/admin/system/mail-preview', ['owner'], fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('System/MailPreview')));
});

it('lists the mails without bodies or codes and loads one', function () {
    $this->postJson('/api/v1/auth/email/start', ['email' => 'lena@beispiel.test', 'attempt_id' => a20Attempt()])->assertStatus(202);
    adm36As('owner');

    $list = $this->get('/admin/system/mail-preview')->assertOk();
    $list->assertInertia(fn (AssertableInertia $p) => $p->component('System/MailPreview')
        ->has('mails', 1)
        ->where('mails.0.to', ['lena@beispiel.test'])
        ->missing('mails.0.code')
        ->missing('mails.0.html')
        ->where('selected', null));

    $open = $this->get('/admin/system/mail-preview?mail=0')->assertOk();
    $open->assertInertia(fn (AssertableInertia $p) => $p->where('selected.index', 0)->missing('selected.html')->has('selected.frame'));

    // DQ-1226: the HTML comes as a document of its own, from the signed URL the opening handed out.
    $frame = (string) $open->viewData('page')['props']['selected']['frame'];
    expect($frame)->toStartWith('/admin/system/mail-preview/0/frame?');
    expect((string) $this->get($frame)->assertOk()->getContent())->toContain('/auth/magic#t=');
});

it('caps the list at the configured 50', function () {
    $mailbox = app(DevMailbox::class);
    foreach (range(1, 55) as $i) {
        $mailbox->store(['at' => now()->toIso8601String(), 'to' => ["m$i@beispiel.test"], 'subject' => "Mail $i", 'html' => '<p>x</p>', 'text' => 'x', 'code' => null]);
    }

    adm36As('owner');
    $this->get('/admin/system/mail-preview')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->has('mails', 50)->where('mails.0.subject', 'Mail 55'));
});

it('refuses a member token', function () {
    Mail::fake();
    [, $token] = a20Passwordless();

    $response = $this->withToken($token)->get('/admin/system/mail-preview');
    expect($response->status())->toBeIn([302, 303]);
});

it('is not registered in production', function () {
    $process = new Process([PHP_BINARY, 'artisan', 'route:list', '--json', '--path=admin/system'], base_path(), ['APP_ENV' => 'production']);
    $process->mustRun();
    $routes = json_decode($process->getOutput(), true, 512, JSON_THROW_ON_ERROR);

    expect(array_column($routes, 'name'))->toContain('admin.system.health')->not->toContain('admin.system.mail-preview')->not->toContain('admin.system.mail-preview.frame');
});

/** A mail in the dev mailbox, and the signed frame URL an opening of it hands out (MailPreviewController::open). */
function adm61Frame(string $at = '2026-11-02T10:00:00+00:00', array $query = []): string
{
    app(DevMailbox::class)->store(['at' => $at, 'to' => ['lena@beispiel.test'], 'subject' => 'Neue Anmeldung', 'html' => '<body style="margin:0;background-color:#F6F6F4;"><p style="color:#111;">Hallo Lena</p></body>', 'text' => 'Hallo Lena', 'code' => null]);

    return URL::temporarySignedRoute('admin.system.mail-preview.frame', now()->addMinutes(10), ['mail' => 0, 'at' => $at, ...$query], absolute: false);
}

describe('DQ-1226 mail frame', function () {
    it('guards the frame by role', function () {
        $frame = adm61Frame();

        assertAdminMatrix('GET', $frame, ['owner'], fn (TestResponse $r) => $r->assertOk());
    });

    it('answers the mail as sent, with a CSP of its own: no scripts, inline styles, sandboxed, framed by the admin only', function () {
        $frame = adm61Frame();
        adm36As('owner');

        $response = $this->get($frame)->assertOk();

        expect((string) $response->getContent())->toContain('style="color:#111;"')->toContain('Hallo Lena')->not->toContain('<script')
            ->and((string) $response->headers->get('Content-Type'))->toStartWith('text/html')
            ->and($response->headers->get('X-Frame-Options'))->toBe('SAMEORIGIN')
            ->and((string) $response->headers->get('Cache-Control'))->toContain('no-store');
        $csp = (string) $response->headers->get('Content-Security-Policy');
        expect($csp)->toContain("default-src 'none'")->toContain("style-src 'unsafe-inline'")->toContain("frame-ancestors 'self'")
            ->toContain('sandbox')->not->toContain('script-src')->not->toContain('nonce-');
    });

    it('refuses an unsigned, tampered or expired URL', function () {
        $frame = adm61Frame();
        adm36As('owner');

        $this->get('/admin/system/mail-preview/0/frame?at='.urlencode('2026-11-02T10:00:00+00:00'))->assertForbidden();
        $this->get(str_replace('/0/frame', '/1/frame', $frame))->assertForbidden();
        $this->get(str_replace(urlencode('2026-11-02T10:00:00+00:00'), urlencode('2026-11-02T10:00:01+00:00'), $frame))->assertForbidden();

        $this->travel(11)->minutes();
        $this->get($frame)->assertForbidden();
    });

    it('answers 404 instead of another mail when a newer one moved the list', function () {
        $frame = adm61Frame();
        app(DevMailbox::class)->store(['at' => '2026-11-02T10:05:00+00:00', 'to' => ['max@beispiel.test'], 'subject' => 'Andere Mail', 'html' => '<p>Andere</p>', 'text' => 'Andere', 'code' => null]);
        adm36As('owner');

        $this->get($frame)->assertNotFound();
    });

    it('keeps every other answer unframeable', function () {
        adm36As('owner');

        expect($this->get('/admin/system/mail-preview')->assertOk()->headers->get('X-Frame-Options'))->toBe('DENY');
    });
});

describe('SEC-M46-04', function () {
    it('lists metadata only and audits every opened mail', function () {
        $this->postJson('/api/v1/auth/email/start', ['email' => 'lena@beispiel.test', 'attempt_id' => a20Attempt()])->assertStatus(202);
        $code = (string) app(DevMailbox::class)->recent()[0]['code'];
        expect($code)->toMatch('/\A\d{6}\z/');
        adm36As('owner');

        $list = $this->get('/admin/system/mail-preview')->assertOk();
        $list->assertInertia(fn (AssertableInertia $page) => $page->has('mails', 1)->missing('mails.0.code')->missing('mails.0.html')->where('selected', null));
        expect((string) $list->getContent())->not->toContain($code)
            ->and(AuditEvent::query()->where('action', 'system.mail_preview_opened')->count())->toBe(0);

        $this->get('/admin/system/mail-preview?mail=0')->assertOk();
        expect(AuditEvent::query()->where('action', 'system.mail_preview_opened')->count())->toBe(1);
    });

    it('refuses the Admin role: the atom is the Owner\'s alone', function () {
        adm36As('admin');

        $this->get('/admin/system/mail-preview')->assertForbidden();
    });

    it('records nothing on a host that really sends mail', function () {
        config(['speedclub.dev_mail.environments' => [], 'mail.default' => 'array']);
        $this->postJson('/api/v1/auth/email/start', ['email' => 'lena@beispiel.test', 'attempt_id' => a20Attempt()])->assertStatus(202);

        expect(app(DevMailbox::class)->recent())->toBe([]);

        config(['mail.default' => 'log']);
        $this->travel(3)->minutes();
        $this->postJson('/api/v1/auth/email/start', ['email' => 'lena@beispiel.test', 'attempt_id' => a20Attempt()])->assertStatus(202);

        expect(app(DevMailbox::class)->recent())->toHaveCount(1);
    });
});
