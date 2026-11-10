<?php

use App\Actions\Admin\Content\DiscardLegalDraft;
use App\Actions\Admin\Content\PublishLegalDocument;
use App\Actions\Admin\Content\SaveLegalDraft;
use App\Enums\ApprovalStatus;
use App\Enums\LegalDocumentKey;
use App\Models\AuditEvent;
use App\Models\LegalDocument;
use App\Services\Config\ConfigRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Config/ConfigHelpers.php';

/**
 * ADM-31: drafts by the Content editor, publish with legal.publish, AGB/Datenschutz with re-consent four-eyes, app-config follows.
 */
beforeEach(function () {
    LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subMonth()]);
    $this->editor = m31Staff('content_editor');
    $this->admin = m31Staff('admin');
    $this->draft = fn (array $input = [], LegalDocumentKey $key = LegalDocumentKey::Terms) => app(SaveLegalDraft::class)->handle($this->editor, $key, 'de', [
        'version' => '2',
        'body_md' => "# AGB\n\n§ 1 Geltungsbereich. Diese Fassung ersetzt Version 1.",
        ...$input,
    ]);
});

it('lets the Content editor draft but not publish; publishing updates app-config and is audited', function () {
    $draft = ($this->draft)();
    expect($draft->published_at)->toBeNull();

    expect(fn () => app(PublishLegalDocument::class)->handle($this->editor, $draft, m35Reason(), PublishLegalDocument::revision($draft)))->toThrow(AuthorizationException::class);
    $this->getJson('/api/v1/app-config')->assertJsonPath('data.legal_versions.terms', '1');

    $outcome = app(PublishLegalDocument::class)->handle($this->admin, $draft, m35Reason(), PublishLegalDocument::revision($draft));

    expect($outcome->waitsForApproval())->toBeFalse()->and($outcome->document->published_at)->not->toBeNull();
    $this->getJson('/api/v1/app-config')->assertJsonPath('data.legal_versions.terms', '2')->assertJsonPath('data.legal_reconsent.terms', null);

    $event = AuditEvent::query()->where('action', 'legal.published')->firstOrFail();
    expect($event->before['version'])->toBe('1')->and($event->after['version'])->toBe('2');
});

it('updates the one draft of a document and refuses a version that exists', function () {
    $first = ($this->draft)();
    $second = ($this->draft)(['version' => '2a']);

    expect($second->id)->toBe($first->id)->and(LegalDocument::query()->whereNull('published_at')->count())->toBe(1);
    expect(fn () => ($this->draft)(['version' => '1']))->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('legal_version_taken'));
});

it('asks for re-consent only on AGB and Datenschutz, with a summary', function () {
    expect(fn () => ($this->draft)(['requires_reconsent' => true]))->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey('summary'));
    expect(fn () => ($this->draft)(['requires_reconsent' => true, 'summary' => 'x'], LegalDocumentKey::Imprint))->toThrow(ValidationException::class);
});

it('publishes AGB with re-consent only after a second staff member approves', function () {
    $draft = ($this->draft)(['requires_reconsent' => true, 'summary' => 'Neue Regeln zu Fotos und Moderation.']);

    $outcome = app(PublishLegalDocument::class)->handle($this->admin, $draft, m35Reason(), PublishLegalDocument::revision($draft));
    expect($outcome->waitsForApproval())->toBeTrue()->and($outcome->approval->action)->toBe('legal.publish_reconsent')
        ->and($draft->fresh()->published_at)->toBeNull();

    expect(m35Approve($outcome->approval)->status)->toBe(ApprovalStatus::Executed)
        ->and($draft->fresh()->published_at)->not->toBeNull();

    $this->getJson('/api/v1/app-config')->assertJsonPath('data.legal_versions.terms', '2')->assertJsonPath('data.legal_reconsent.terms', '2');
});

it('refuses the re-consent executor outside its approval and a second publish', function () {
    $draft = ($this->draft)(['requires_reconsent' => true, 'summary' => 'Neue Regeln.']);

    expect(fn () => app(PublishLegalDocument::class)->execute($this->admin, m31Staff('owner'), $draft, m35Reason()))->toThrow(AuthorizationException::class);

    $plain = ($this->draft)(['requires_reconsent' => false]);
    app(PublishLegalDocument::class)->handle($this->admin, $plain, m35Reason(), PublishLegalDocument::revision($plain));
    expect(fn () => app(PublishLegalDocument::class)->handle($this->admin, $plain->fresh(), m35Reason(), PublishLegalDocument::revision($plain->fresh())))->toThrow(fn (ConfigRefused $e) => expect($e->reason)->toBe('legal_not_draft'));
    expect(fn () => app(DiscardLegalDraft::class)->handle($this->editor, $plain->fresh()))->toThrow(ConfigRefused::class);
});
