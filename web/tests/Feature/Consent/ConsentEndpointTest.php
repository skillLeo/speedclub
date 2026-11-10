<?php

use App\Actions\Admin\Content\PublishLegalDocument;
use App\Actions\Admin\Content\SaveLegalDraft;
use App\Enums\LegalDocumentKey;
use App\Enums\RestrictionType;
use App\Models\AuditEvent;
use App\Models\LegalDocument;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Admin/Config/ConfigHelpers.php';

/**
 * GET/POST me/consents (ADM-31 re-consent): after AGB are published with re-consent, a member who accepted an older version must
 * accept the current one; accepting writes the version and an audit event.
 */
beforeEach(function () {
    foreach ([LegalDocumentKey::Terms, LegalDocumentKey::Privacy] as $key) {
        LegalDocument::factory()->published()->create(['key' => $key, 'locale' => 'de', 'version' => '1', 'published_at' => now()->subMonth()]);
    }

    $this->member = User::factory()->create(['terms_version' => '1', 'privacy_version' => '1', 'consented_at' => now()->subMonth(), 'locale' => 'de']);
});

function m35Reconsent(string $version = '2'): LegalDocument
{
    $draft = app(SaveLegalDraft::class)->handle(m31Staff('content_editor'), LegalDocumentKey::Terms, 'de', [
        'version' => $version,
        'body_md' => "# AGB\n\nNeue Fassung mit Regeln zu Fotos.",
        'requires_reconsent' => true,
        'summary' => 'Neue Regeln zu Fotos und Moderation.',
    ]);
    m35Approve(app(PublishLegalDocument::class)->handle(m31Staff('admin'), $draft, m35Reason(), PublishLegalDocument::revision($draft))->approval);

    return $draft->fresh();
}

it('needs a signed-in member', function () {
    $this->getJson('/api/v1/me/consents')->assertUnauthorized();
    $this->postJson('/api/v1/me/consents', ['terms_version' => '1'])->assertUnauthorized();
});

it('asks for nothing until a re-consent version is published, then for the new AGB', function () {
    Sanctum::actingAs($this->member);
    $this->getJson('/api/v1/me/consents')->assertOk()->assertJsonPath('data.required', [])->assertJsonPath('data.accepted.terms', '1');

    m35Reconsent();

    $this->getJson('/api/v1/me/consents')->assertOk()
        ->assertJsonCount(1, 'data.required')
        ->assertJsonPath('data.required.0.key', 'terms')
        ->assertJsonPath('data.required.0.version', '2')
        ->assertJsonPath('data.required.0.summary', 'Neue Regeln zu Fotos und Moderation.');
    $this->getJson('/api/v1/app-config')->assertJsonPath('data.legal_reconsent.terms', '2');
});

it('accepts the current version, audits it, and asks no more', function () {
    m35Reconsent();
    Sanctum::actingAs($this->member);

    $this->postJson('/api/v1/me/consents', ['terms_version' => '2'])->assertOk()->assertJsonPath('data.required', [])->assertJsonPath('data.accepted.terms', '2');

    expect($this->member->fresh()->terms_version)->toBe('2')->and($this->member->fresh()->consented_at->isToday())->toBeTrue();
    $event = AuditEvent::query()->where('action', 'member.consent_accepted')->firstOrFail();
    expect($event->before)->toBe(['terms_version' => '1'])->and($event->after)->toBe(['terms_version' => '2'])->and($event->actor_type->value)->toBe('member');
});

it('refuses an outdated version and an empty body', function () {
    m35Reconsent();
    Sanctum::actingAs($this->member);

    $this->postJson('/api/v1/me/consents', ['terms_version' => '1'])->assertStatus(422)->assertJsonValidationErrors(['terms_version']);
    $this->postJson('/api/v1/me/consents', [])->assertStatus(422)->assertJsonValidationErrors(['terms_version', 'privacy_version']);
    expect($this->member->fresh()->terms_version)->toBe('1');
});

it('stays open to a restricted member and acts only on the signed-in member', function () {
    m35Reconsent();
    $other = User::factory()->create(['terms_version' => '1']);
    $this->member->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => null]]])->save();
    Sanctum::actingAs($this->member->fresh());

    $this->postJson('/api/v1/me/consents', ['terms_version' => '2'])->assertOk();
    expect($other->fresh()->terms_version)->toBe('1');
});

it('replays one answer per Idempotency-Key', function () {
    m35Reconsent();
    Sanctum::actingAs($this->member);

    $first = $this->withHeader('Idempotency-Key', 'consent-key-0001')->postJson('/api/v1/me/consents', ['terms_version' => '2'])->assertOk();
    $second = $this->withHeader('Idempotency-Key', 'consent-key-0001')->postJson('/api/v1/me/consents', ['terms_version' => '2'])->assertOk();

    expect($second->json())->toBe($first->json())
        ->and(AuditEvent::query()->where('action', 'member.consent_accepted')->count())->toBe(1);
});

it('is rate limited with the account edits (60 a minute)', function () {
    Sanctum::actingAs($this->member);
    $max = config()->integer('speedclub.rate_limits.account_edits.max');

    for ($i = 0; $i < $max; $i++) {
        $this->postJson('/api/v1/me/consents', ['terms_version' => '1'])->assertOk();
    }

    $this->postJson('/api/v1/me/consents', ['terms_version' => '1'])->assertStatus(429);
});
