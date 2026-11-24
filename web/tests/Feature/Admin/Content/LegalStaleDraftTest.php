<?php

use App\Actions\Admin\Content\PublishLegalDocument;
use App\Actions\Admin\Content\SaveLegalDraft;
use App\Enums\ApprovalStatus;
use App\Enums\LegalDocumentKey;
use App\Http\Controllers\Admin\Config\Support\AdminText;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\LegalDocument;
use App\Services\Config\ConfigRefused;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Config/ConfigHelpers.php';
require_once __DIR__.'/../M32/Helpers.php';

/**
 * DQ-P5-101 (Phase 5 gate): a legal draft started from an older text than the live one is never published. The publish Action refuses
 * it on every path (direct, re-consent request, approved execution) with both versions and writes nothing; a draft on the live text
 * still publishes; ADM-31 gets both versions for its stale-draft warning.
 */
beforeEach(function () {
    Mail::fake();
    $this->v1 = LegalDocument::factory()->create([
        'key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '1', 'body_md' => "# AGB\n\n§ 1 Geltungsbereich.", 'published_at' => now()->subMonth(),
    ]);
    $this->editor = m31Staff('content_editor');
    $this->draftOn = fn (array $input = []) => app(SaveLegalDraft::class)->handle($this->editor, LegalDocumentKey::Terms, 'de', [
        'version' => '3',
        'body_md' => "# AGB\n\n§ 1 Geltungsbereich. Ein neuer Absatz zu Treffen.",
        ...$input,
    ]);
    // Version 2 goes live while the draft is open (a deploy's data migration, or another publisher).
    $this->publishNewer = fn () => LegalDocument::factory()->create([
        'key' => LegalDocumentKey::Terms, 'locale' => 'de', 'version' => '2', 'body_md' => "# AGB\n\n§ 1 Geltungsbereich.\n\n§ 9 Shop.", 'published_at' => now()->subMinute(),
    ]);
});

it('records the live version a new draft starts from and keeps it on later saves', function () {
    $draft = ($this->draftOn)();
    expect($draft->based_on_id)->toBe($this->v1->id);

    ($this->publishNewer)();
    $saved = ($this->draftOn)(['body_md' => "# AGB\n\n§ 1 Geltungsbereich. Noch ein Satz zu Treffen."]);

    expect($saved->id)->toBe($draft->id)->and($saved->fresh()->based_on_id)->toBe($this->v1->id);
});

it('refuses to publish a draft based on an older version and writes nothing', function () {
    $draft = ($this->draftOn)();
    ($this->publishNewer)();
    adm32SignedIn('admin');
    $audits = AuditEvent::query()->count();

    $this->postJson("/admin/content/legal/drafts/{$draft->id}/publish", ['reason' => adm32Reason(), 'revision' => PublishLegalDocument::revision($draft)])
        ->assertUnprocessable()
        ->assertJsonPath('code', 'legal_draft_stale')
        ->assertJsonPath('message', 'Dieser Entwurf basiert auf Version 1, live ist inzwischen Version 2. Beim Veröffentlichen würden die neueren Abschnitte fehlen. Setz den Entwurf mit dem Live-Text neu auf.');

    expect($draft->fresh()->published_at)->toBeNull()
        ->and(LegalDocument::query()->whereNotNull('published_at')->count())->toBe(2)
        ->and(AuditEvent::query()->count())->toBe($audits)
        ->and(AuditEvent::query()->where('action', 'legal.published')->exists())->toBeFalse();
});

it('answers the stale refusal in English for an English admin', function () {
    $draft = ($this->draftOn)();
    ($this->publishNewer)();
    app()->setLocale('en');

    expect(fn () => app(PublishLegalDocument::class)->handle(m31Staff('admin'), $draft, adm32Reason(), PublishLegalDocument::revision($draft)))
        ->toThrow(function (ConfigRefused $refused) {
            expect($refused->reason)->toBe('legal_draft_stale')->and($refused->context)->toBe(['base' => '1', 'live' => '2'])
                ->and(AdminText::refusal($refused))
                ->toBe('This draft is based on version 1, but version 2 is live now. Publishing it would drop the newer sections. Start the draft again from the live text.');
        });
});

it('refuses a stale re-consent draft before any approval is requested', function () {
    $draft = ($this->draftOn)(['requires_reconsent' => true, 'summary' => 'Neue Regeln zu Treffen.']);
    ($this->publishNewer)();
    adm32SignedIn('admin');

    $this->postJson("/admin/content/legal/drafts/{$draft->id}/publish", ['reason' => adm32Reason(), 'revision' => PublishLegalDocument::revision($draft)])
        ->assertUnprocessable()->assertJsonPath('code', 'legal_draft_stale');

    expect(ApprovalRequest::query()->where('action', 'legal.publish_reconsent')->count())->toBe(0)
        ->and($draft->fresh()->published_at)->toBeNull();
});

it('fails an approval given before a newer version went live, and the draft stays unpublished', function () {
    $draft = ($this->draftOn)(['requires_reconsent' => true, 'summary' => 'Neue Regeln zu Treffen.']);
    $outcome = app(PublishLegalDocument::class)->handle(m31Staff('admin'), $draft, adm32Reason(), PublishLegalDocument::revision($draft));
    expect($outcome->waitsForApproval())->toBeTrue();

    ($this->publishNewer)();

    expect(m35Approve($outcome->approval)->status)->toBe(ApprovalStatus::Failed)
        ->and($draft->fresh()->published_at)->toBeNull()
        ->and(AuditEvent::query()->where('action', 'legal.published')->exists())->toBeFalse();
});

it('still publishes a draft based on the live version', function (bool $legacy) {
    ($this->publishNewer)();
    $draft = ($this->draftOn)();
    expect($draft->based_on_id)->toBe(LegalDocument::query()->where('version', '2')->value('id'));

    if ($legacy) {
        // A draft from before based_on_id: its base is the version live when it was created.
        DB::table('legal_documents')->where('id', $draft->id)->update(['based_on_id' => null]);
        $draft->refresh();
    }

    adm32SignedIn('admin');
    $this->post("/admin/content/legal/drafts/{$draft->id}/publish", ['reason' => adm32Reason(), 'revision' => PublishLegalDocument::revision($draft)])
        ->assertStatus(303)->assertSessionHas('success', 'content.flash.legal_published');

    expect($draft->fresh()->published_at)->not->toBeNull()
        ->and(AuditEvent::query()->where('action', 'legal.published')->sole()->before['version'])->toBe('2');
})->with(['with a recorded base' => [false], 'legacy draft without one' => [true]]);

it('treats a legacy draft created before the live version as stale', function () {
    $draft = ($this->draftOn)();
    DB::table('legal_documents')->where('id', $draft->id)->update(['based_on_id' => null, 'created_at' => now()->subWeek()]);
    ($this->publishNewer)();

    expect(fn () => app(PublishLegalDocument::class)->handle(m31Staff('admin'), $draft->fresh(), adm32Reason(), PublishLegalDocument::revision($draft)))
        ->toThrow(fn (ConfigRefused $refused) => expect($refused->reason)->toBe('legal_draft_stale')->and($refused->context)->toBe(['base' => '1', 'live' => '2']));
});

it('refuses a draft begun before any version was live once one is', function () {
    LegalDocument::query()->delete();
    $draft = ($this->draftOn)();
    expect($draft->based_on_id)->toBeNull();
    // The draft was begun an hour ago; version 2 went live a minute ago.
    DB::table('legal_documents')->where('id', $draft->id)->update(['created_at' => now()->subHour()]);
    $draft->refresh();
    ($this->publishNewer)();

    expect(fn () => app(PublishLegalDocument::class)->handle(m31Staff('admin'), $draft, adm32Reason(), PublishLegalDocument::revision($draft)))
        ->toThrow(fn (ConfigRefused $refused) => expect($refused->reason)->toBe('legal_draft_stale_first')->and($refused->context)->toBe(['base' => null, 'live' => '2']));
});

it('gives ADM-31 both versions of a stale draft, and none for a current one', function () {
    $draft = ($this->draftOn)();
    adm32SignedIn('content_editor');

    $this->get('/admin/content/legal?document=terms&locale=de')->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->component('Content/Legal')->where('draft.id', $draft->id)->where('draft.stale', null));

    ($this->publishNewer)();

    $this->get('/admin/content/legal?document=terms&locale=de')->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->where('draft.stale', ['base' => '1', 'live' => '2'])->where('current.version', '2'));
});

it('lets the editor start again from the live text: discard, then a new draft based on it', function () {
    $stale = ($this->draftOn)();
    ($this->publishNewer)();
    adm32SignedIn('content_editor');

    $this->delete("/admin/content/legal/drafts/{$stale->id}")->assertStatus(303);
    $this->post('/admin/content/legal/terms/de/draft', ['version' => '3', 'body_md' => "# AGB\n\n§ 1 Geltungsbereich.\n\n§ 9 Shop. Neu: Treffen.", 'revision' => ''])->assertStatus(303);

    $fresh = LegalDocument::query()->whereNull('published_at')->sole();
    expect($fresh->based_on_id)->toBe(LegalDocument::query()->where('version', '2')->value('id'));

    adm32SignedIn('admin');
    $this->post("/admin/content/legal/drafts/{$fresh->id}/publish", ['reason' => adm32Reason(), 'revision' => PublishLegalDocument::revision($fresh)])->assertStatus(303);
    expect($fresh->fresh()->published_at)->not->toBeNull();
});
