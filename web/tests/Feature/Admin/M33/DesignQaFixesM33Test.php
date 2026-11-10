<?php

use App\Actions\Support\CreateSupportTicket;
use App\Enums\CatalogRequestStatus;
use App\Enums\SupportCategory;
use App\Models\SupportTicket;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';
require_once __DIR__.'/../M34/Helpers.php';

/**
 * Fixes after the M3.3 design QA (docs/reports/design-qa/phase-3/2026-11-09-M3.3.md), lane b.
 */
beforeEach(fn () => Queue::fake());

it('caps the rejection reason at the 500 characters the member reads (DQ-607)', function () {
    $request = adm33Request();
    adm32SignedIn('content_editor');

    $this->post("/admin/catalog/requests/{$request->id}/reject", ['reason' => str_repeat('a', 501)])->assertSessionHasErrors('reason');
    expect($request->refresh()->status)->toBe(CatalogRequestStatus::Pending);

    $this->post("/admin/catalog/requests/{$request->id}/reject", ['reason' => str_repeat('b', 500)])->assertSessionHas('success', 'catalog.flash.request_rejected');
    expect($request->refresh()->rejection_reason)->toBe(str_repeat('b', 500));
});

it('sorts tickets on the activity the list shows, falling back to updated_at for a ticket without activity yet (DQ-597)', function () {
    Mail::fake();
    $tickets = app(CreateSupportTicket::class);
    $quiet = $tickets->forGuest('Thomas Berger', 'thomas.berger@beispiel.test', SupportCategory::Account, 'Bitte löscht mein altes Konto.', 'de');
    $answered = $tickets->forGuest('Lena Kraus', 'lena.kraus@beispiel.test', SupportCategory::Account, 'Mein Sticker ist abgefallen.', 'de');
    $older = $tickets->forGuest('Jan Vogt', 'jan.vogt@beispiel.test', SupportCategory::Account, 'Wie ändere ich den Benutzernamen?', 'de');

    SupportTicket::query()->whereKey($quiet->id)->update(['last_activity_at' => null, 'updated_at' => now()->subDay()]);
    SupportTicket::query()->whereKey($answered->id)->update(['last_activity_at' => now()->subDays(2), 'updated_at' => now()]);
    SupportTicket::query()->whereKey($older->id)->update(['last_activity_at' => null, 'updated_at' => now()->subDays(3)]);
    adm34As('support');

    $order = fn (string $query): array => array_column($this->get('/admin/support/tickets'.$query)->assertOk()->viewData('page')['props']['rows']['data'], 'id');

    expect($order(''))->toBe([$quiet->id, $answered->id, $older->id])
        ->and($order('?sort=last_activity_at'))->toBe([$older->id, $answered->id, $quiet->id])
        ->and($order('?sort=-last_activity_at'))->toBe([$quiet->id, $answered->id, $older->id]);
});

it('names both participants of a message case in the list (DQ-598)', function () {
    [$case] = adm34MessageCase();
    adm34As('moderator');

    $this->get('/admin/moderation/messages')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p
        ->where('rows.data.0.id', $case->id)
        ->where('rows.data.0.reporter', 'aylin.adm34'));
});
