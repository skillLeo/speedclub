<?php

use App\Actions\Admin\Content\PublishLegalDocument;
use App\Actions\Admin\Content\SaveLegalDraft;
use App\Enums\ApprovalStatus;
use App\Enums\LegalDocumentKey;
use App\Models\ApprovalRequest;
use App\Models\LegalDocument;
use App\Services\Approvals\Approvals;
use App\Services\Config\ConfigRefused;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

require_once __DIR__.'/../M35/Helpers.php';

/**
 * Code review phase-3-final SF-4: the revision of the draft the publisher saw is mandatory on every ADM-31 publish, and the four-eyes
 * path checks it too: a re-consent approval is requested only for the locked row the requester saw, and pins that row.
 */
beforeEach(function () {
    Mail::fake();
    m35FakeDisks();
});

function sf4Reconsent(): LegalDocument
{
    return app(SaveLegalDraft::class)->handle(m31Staff('content_editor'), LegalDocumentKey::Terms, 'de', [
        'version' => '5',
        'body_md' => "# AGB\n\nDie Fassung, die das Team geprüft hat.",
        'requires_reconsent' => true,
        'summary' => 'Neue Regeln zu QR-Stickern.',
    ]);
}

it('refuses a publish without a revision, direct or four-eyes', function (bool $reconsent) {
    $draft = $reconsent ? sf4Reconsent() : app(SaveLegalDraft::class)->handle(m31Staff('content_editor'), LegalDocumentKey::Imprint, 'de', ['version' => '4', 'body_md' => "# Impressum\n\nNeue Anschrift der Redaktion."]);
    adm32SignedIn('admin');

    $this->postJson("/admin/content/legal/drafts/{$draft->id}/publish", ['reason' => adm32Reason()])->assertUnprocessable()->assertJsonValidationErrors(['revision']);
    $this->postJson("/admin/content/legal/drafts/{$draft->id}/publish", ['reason' => adm32Reason(), 'revision' => ''])->assertUnprocessable()->assertJsonValidationErrors(['revision']);

    expect($draft->refresh()->published_at)->toBeNull()
        ->and(ApprovalRequest::query()->where('action', 'legal.publish_reconsent')->count())->toBe(0);
})->with(['direct' => [false], 'four-eyes' => [true]]);

it('answers 409 stale_revision and requests no approval when the re-consent draft moved since the page loaded it', function () {
    $draft = sf4Reconsent();
    $seen = PublishLegalDocument::revision($draft);
    // Another editor saves a different text (or another summary) before the publisher clicks.
    DB::table('legal_documents')->where('id', $draft->id)->update(['body_md' => "# AGB\n\nUntergeschobener Text, den niemand geprüft hat."]);

    adm32SignedIn('admin');
    $this->postJson("/admin/content/legal/drafts/{$draft->id}/publish", ['reason' => adm32Reason(), 'revision' => $seen])->assertStatus(409)->assertJsonPath('code', 'stale_revision');

    expect(ApprovalRequest::query()->where('action', 'legal.publish_reconsent')->count())->toBe(0)
        ->and($draft->refresh()->published_at)->toBeNull();
});

it('checks the revision against the locked row, not the model the caller loaded', function () {
    $draft = sf4Reconsent();
    $loaded = LegalDocument::query()->findOrFail($draft->id);
    DB::table('legal_documents')->where('id', $draft->id)->update(['summary' => 'Eine ganz andere Zusammenfassung.']);

    expect(fn () => app(PublishLegalDocument::class)->handle(m31Staff('admin'), $loaded, adm32Reason(), PublishLegalDocument::revision($loaded)))
        ->toThrow(fn (ConfigRefused $refused) => expect($refused->reason)->toBe('stale_revision'));
    expect(ApprovalRequest::query()->where('action', 'legal.publish_reconsent')->count())->toBe(0);
});

it('requests the approval for the text the requester saw, pins it, and publishes it on approval', function () {
    $draft = sf4Reconsent();
    adm32SignedIn('admin');

    $this->post("/admin/content/legal/drafts/{$draft->id}/publish", ['reason' => adm32Reason(), 'revision' => PublishLegalDocument::revision($draft)])->assertStatus(303);

    $request = ApprovalRequest::query()->where('action', 'legal.publish_reconsent')->sole();
    expect($request->payload)->toMatchArray(['document_id' => $draft->id, 'version' => '5', 'body_sha256' => hash('sha256', $draft->body_md), 'summary' => 'Neue Regeln zu QR-Stickern.'])
        ->and(app(Approvals::class)->approve($request, m31Staff('owner'))->status)->toBe(ApprovalStatus::Executed)
        ->and($draft->refresh()->published_at)->not->toBeNull();
});

it('refuses a direct publish with another revision', function () {
    $draft = app(SaveLegalDraft::class)->handle(m31Staff('content_editor'), LegalDocumentKey::Imprint, 'de', ['version' => '4', 'body_md' => "# Impressum\n\nNeue Anschrift der Redaktion."]);

    expect(fn () => app(PublishLegalDocument::class)->handle(m31Staff('admin'), $draft, adm32Reason(), str_repeat('0', 64)))
        ->toThrow(fn (ConfigRefused $refused) => expect($refused->reason)->toBe('stale_revision'));
    expect($draft->refresh()->published_at)->toBeNull();
});
