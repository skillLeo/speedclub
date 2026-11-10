<?php

use App\Actions\Support\CreateSupportTicket;
use App\Enums\SupportCategory;
use App\Models\AuditEvent;
use App\Services\Rules\RateLimitOverrides;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * Fixes after the M3.4 design QA and the A1/A2 flows (lane b).
 */
beforeEach(fn () => Queue::fake());

it('keeps the decision flash for the next page when a statement preview lands in between', function () {
    $case = adm34VehicleCase();
    adm34As('moderator');

    // The decide request has answered with its flash (aged at the end of that request); a debounced preview arrives before the GET.
    session()->flash('success', 'moderation.flash.decided');
    session()->ageFlashData();

    $this->postJson("/admin/moderation/cases/{$case->id}/preview", ['action' => 'no_action'])->assertOk()->assertJsonMissingPath('flash');
    $this->get("/admin/moderation/cases/{$case->id}")->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->where('flash.success', 'moderation.flash.decided'));
});

it('labels every request limiter in German and English (DQ-557)', function () {
    $names = array_keys(RateLimitOverrides::defaults());
    expect($names)->not->toBeEmpty();

    foreach (['de', 'en'] as $locale) {
        $labels = json_decode((string) file_get_contents(lang_path("admin/$locale/moderation.json")), true)['rules']['limits']['names'] ?? [];
        expect(array_values(array_diff($names, array_keys($labels))))->toBe([], "limiters without a $locale label");
    }
});

it('masks web contacts in the list and on the ticket for every role, and reveals the address only through the audited JSON (DQ-563)', function () {
    Mail::fake();
    $ticket = app(CreateSupportTicket::class)->forGuest('Thomas Berger', 'thomas.berger@beispiel.test', SupportCategory::Account, 'Ich bekomme noch E-Mails nach der Löschung.', 'de');
    adm34As('support');

    $this->get('/admin/support/tickets')->assertInertia(fn (AssertableInertia $p) => $p->where('rows.data.0.from.email', fn (string $email) => ! str_contains($email, 'thomas.berger')));
    $this->get("/admin/support/tickets/{$ticket->id}")->assertInertia(fn (AssertableInertia $p) => $p->where('ticket.from.email', fn (string $email) => ! str_contains($email, 'thomas.berger')));

    $this->postJson("/admin/support/tickets/{$ticket->id}/contact")->assertOk()->assertExactJson(['email' => 'thomas.berger@beispiel.test']);
    $this->post("/admin/support/tickets/{$ticket->id}/contact", [], ['X-Inertia' => 'true'])->assertStatus(409);
    expect(AuditEvent::query()->where('action', 'support.contact_viewed')->where('target_id', $ticket->id)->count())->toBe(1);

    app('auth')->forgetGuards();
    adm34As('analyst');
    $this->postJson("/admin/support/tickets/{$ticket->id}/contact")->assertForbidden();
});
