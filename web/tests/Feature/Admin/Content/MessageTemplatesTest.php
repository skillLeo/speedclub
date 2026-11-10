<?php

use App\Actions\Admin\Content\ResetMessageTemplate;
use App\Actions\Admin\Content\SaveMessageTemplate;
use App\Actions\Admin\Content\SendTemplateTest;
use App\Enums\SupportCategory;
use App\Mail\SupportTicketReceivedMail;
use App\Mail\TemplateTestMail;
use App\Models\AuditEvent;
use App\Services\Config\ConfigRefused;
use App\Services\Content\MessageTemplates;
use App\Services\Content\TemplateRegistry;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Config/ConfigHelpers.php';

/**
 * ADM-33: overrides of editable mail and push texts, applied at send time; fixed auth/legal parts refused; test send to me only.
 */
beforeEach(function () {
    $this->editor = m31Staff('content_editor');
});

it('applies a saved subject to the real mail and restores the default after a reset', function () {
    $default = (string) __('mail.support.subject', [], 'de');

    app(SaveMessageTemplate::class)->handle($this->editor, 'mail.support_received', 'de', ['subject' => 'Danke für deine Nachricht']);

    App::setLocale('de');
    expect((new SupportTicketReceivedMail(SupportCategory::Account, 'SC-1'))->envelope()->subject)->toBe('Danke für deine Nachricht');

    app(ResetMessageTemplate::class)->handle($this->editor, 'mail.support_received', 'de');
    expect((new SupportTicketReceivedMail(SupportCategory::Account, 'SC-1'))->envelope()->subject)->toBe($default);

    expect(AuditEvent::query()->whereIn('action', ['template.saved', 'template.reset'])->count())->toBe(2);
});

it('applies push texts too', function () {
    app(SaveMessageTemplate::class)->handle($this->editor, 'push.title', 'en', ['text' => 'SPEED CLUB News']);
    app(MessageTemplates::class)->apply('en');

    expect(__('notifications.title', [], 'en'))->toBe('SPEED CLUB News')->and(__('notifications.title', [], 'de'))->toBe('SPEED CLUB');
});

it('refuses fixed templates and fields, unknown placeholders and lost plural forms', function (string $key, array $fields, string $expected) {
    $run = fn () => app(SaveMessageTemplate::class)->handle($this->editor, $key, 'de', $fields);

    $expected === 'fixed' ? expect($run)->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('template_fixed')) : expect($run)->toThrow(ValidationException::class);
})->with([
    'sign-in code mail' => ['mail.verification', ['subject' => 'Dein Code'], 'fixed'],
    'DSA decision mail' => ['mail.moderation_decision', ['subject' => 'Entscheidung'], 'fixed'],
    'redress line' => ['mail.report_outcome', ['redress' => 'Kein Widerspruch.'], 'fixed'],
    'unknown field' => ['mail.support_received', ['footer' => 'x'], 'fixed'],
    'unknown placeholder' => ['mail.support_received', ['intro' => 'Hallo :password'], 'validation'],
    'plural forms' => ['push.new_follower', ['text' => '@:name folgt dir.'], 'validation'],
]);

it('lists variables from the default text', function () {
    $defaults = app(TemplateRegistry::class)->defaults('push.qr_milestone', 'de');

    expect(TemplateRegistry::variables($defaults['text']))->toEqualCanonicalizing(['vehicle', 'count']);
});

it('sends a test only to the staff member\'s own address, with the unsaved text, audited', function () {
    Mail::fake();

    app(SendTemplateTest::class)->handle($this->editor, 'mail.support_received', 'de', ['subject' => 'Entwurf: Danke']);

    Mail::assertSent(TemplateTestMail::class, fn (TemplateTestMail $mail) => $mail->hasTo($this->editor->email) && count($mail->to) === 1
        && $mail->fields['subject'] === 'Entwurf: Danke');
    expect(AuditEvent::query()->where('action', 'template.test_sent')->firstOrFail()->after)->toBe(['key' => 'mail.support_received', 'locale' => 'de', 'unsaved' => true]);
});

it('checks content.edit inside', function (string $role, bool $allowed) {
    $run = fn () => app(SaveMessageTemplate::class)->handle(m31Staff($role), 'mail.support_received', 'de', ['subject' => 'Danke']);

    $allowed ? expect($run())->not->toBeNull() : expect($run)->toThrow(AuthorizationException::class);
})->with(m35Matrix('content.edit'));
