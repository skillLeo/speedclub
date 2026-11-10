<?php

use App\Enums\RestrictionType;
use App\Enums\SupportCategory;
use App\Enums\SupportTicketSource;
use App\Enums\TicketAuthorType;
use App\Mail\SupportTicketReceivedMail;
use App\Models\HelpArticle;
use App\Models\SupportTicket;
use App\Models\User;
use Database\Seeders\HelpArticleSeeder;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SettingsTestHelpers.php';

beforeEach(function () {
    // Symfony's test requests say en-us; the copy checked here is German.
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
});

describe('SET-14 help', function () {
    it('seeds about ten real articles in German and English, and keeps edits on a second run', function () {
        $this->seed(HelpArticleSeeder::class);

        expect(HelpArticle::query()->where('locale', 'de')->count())->toBeGreaterThanOrEqual(10)
            ->and(HelpArticle::query()->where('locale', 'en')->count())->toBe(HelpArticle::query()->where('locale', 'de')->count())
            ->and(HelpArticle::query()->where('key', 'mods-legal')->where('locale', 'de')->value('body_md'))->toContain('Angaben des Besitzers, keine rechtliche Prüfung.');

        HelpArticle::query()->where('key', 'themes')->where('locale', 'de')->update(['title' => 'Bearbeitet im Admin']);
        $this->seed(HelpArticleSeeder::class);
        expect(HelpArticle::query()->where('key', 'themes')->where('locale', 'de')->value('title'))->toBe('Bearbeitet im Admin');
    });

    it('lists published articles in the request language, German as the fallback, in order', function () {
        HelpArticle::factory()->create(['key' => 'qr-sticker', 'locale' => 'de', 'title' => 'QR-Sticker', 'sort' => 1]);
        HelpArticle::factory()->create(['key' => 'qr-sticker', 'locale' => 'en', 'title' => 'QR sticker', 'sort' => 1]);
        HelpArticle::factory()->create(['key' => 'themes', 'locale' => 'de', 'title' => 'Designs', 'sort' => 2]);
        HelpArticle::factory()->create(['key' => 'draft', 'locale' => 'de', 'title' => 'Entwurf', 'published' => false]);

        $this->getJson('/api/v1/help')->assertOk()->assertExactJson(['data' => [
            ['key' => 'qr-sticker', 'title' => 'QR-Sticker', 'locale' => 'de'],
            ['key' => 'themes', 'title' => 'Designs', 'locale' => 'de'],
        ]]);

        $this->getJson('/api/v1/help', ['Accept-Language' => 'en'])->assertOk()
            ->assertJsonPath('data.0.title', 'QR sticker')
            ->assertJsonPath('data.1.locale', 'de');
    });

    it('shows one article with its Markdown, 404 for unknown and unpublished keys, with an ETag', function () {
        HelpArticle::factory()->create(['key' => 'qr-sticker', 'locale' => 'de', 'body_md' => "## Sticker\n\nText"]);
        HelpArticle::factory()->create(['key' => 'draft', 'locale' => 'de', 'published' => false]);

        $response = $this->getJson('/api/v1/help/qr-sticker')->assertOk()->assertJsonPath('data.body_md', "## Sticker\n\nText");
        $etag = (string) $response->headers->get('ETag');
        $this->getJson('/api/v1/help/qr-sticker', ['If-None-Match' => $etag])->assertStatus(304);

        $this->getJson('/api/v1/help/draft')->assertNotFound();
        $this->getJson('/api/v1/help/nope')->assertNotFound();
        $this->getJson('/api/v1/help/UPPER')->assertNotFound();
    });
});

describe('SET-15 support tickets', function () {
    it('creates a ticket with its first message and mails a receipt to the account', function () {
        $member = setMember(['email' => 'aylin@example.de']);
        Sanctum::actingAs($member);

        $response = $this->postJson('/api/v1/support/tickets', ['category' => 'qr', 'subject' => 'Sticker zeigt privat', 'message' => 'Mein Sticker zeigt seit gestern privat an, obwohl der Build öffentlich ist.'])
            ->assertCreated()
            ->assertJsonPath('data.category', 'qr')
            ->assertJsonPath('data.status', 'open');

        $ticket = SupportTicket::query()->findOrFail($response->json('data.id'));
        expect($ticket->source)->toBe(SupportTicketSource::App)
            ->and($ticket->user_id)->toBe($member->id)
            ->and($ticket->getAttribute('email'))->toBeNull()
            ->and($ticket->messages()->first()?->author_type)->toBe(TicketAuthorType::Member)
            ->and($response->json('data.reference'))->toMatch('/\ASC-[0-9A-Z]{8}\z/');

        Mail::assertQueued(SupportTicketReceivedMail::class, fn (SupportTicketReceivedMail $mail): bool => $mail->hasTo('aylin@example.de') && $mail->category === SupportCategory::Qr);
    });

    it('is open to unverified and restricted members', function (Closure $make) {
        Sanctum::actingAs($make());

        $this->postJson('/api/v1/support/tickets', ['category' => 'account', 'subject' => 'Hilfe bitte', 'message' => 'Ich komme nicht weiter mit meinem Konto.'])->assertCreated();
    })->with([
        'unverified' => [fn () => setMember(['email_verified_at' => null])],
        'suspended' => [fn () => User::factory()->suspended()->create()],
        'restricted' => [fn () => User::factory()->restrictedFrom(RestrictionType::Messaging)->create()],
    ]);

    it('validates', function (array $body, string $field) {
        Sanctum::actingAs(setMember());

        $this->postJson('/api/v1/support/tickets', [...['category' => 'other', 'subject' => 'Frage', 'message' => 'Eine Frage zu meinem Konto bitte.'], ...$body])
            ->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'category' => [['category' => 'billing'], 'category'],
        'short subject' => [['subject' => 'x'], 'subject'],
        'long subject' => [['subject' => str_repeat('a', 121)], 'subject'],
        'short message' => [['message' => 'kurz'], 'message'],
        'long message' => [['message' => str_repeat('a', 5001)], 'message'],
    ]);

    it('replays one ticket for one Idempotency-Key and limits five an hour', function () {
        Sanctum::actingAs(setMember());
        $body = ['category' => 'other', 'subject' => 'Frage', 'message' => 'Eine Frage zu meinem Konto bitte.'];

        $first = $this->withHeader('Idempotency-Key', 'ticket-key-0001')->postJson('/api/v1/support/tickets', $body)->assertCreated();
        $this->withHeader('Idempotency-Key', 'ticket-key-0001')->postJson('/api/v1/support/tickets', $body)->assertCreated()->assertJsonPath('data.id', $first->json('data.id'));
        expect(SupportTicket::query()->count())->toBe(1);

        for ($i = 0; $i < 3; $i++) {
            $this->postJson('/api/v1/support/tickets', $body)->assertCreated();
        }

        $this->postJson('/api/v1/support/tickets', $body)->assertStatus(429);
    });
});

describe('WEB-10 /kontakt', function () {
    it('renders both pages in English too', function () {
        $this->get('/kontakt?lang=en')->assertOk()->assertSee('Send message')->assertSee('Account and sign-in');
        $this->get('/konto-loeschen?lang=en')->assertOk()->assertSee('What happens when you delete')->assertSee('Delete account for good');
    });

    it('renders without a session and creates a guest ticket', function () {
        $page = $this->get('/kontakt')->assertOk()->assertSee('data-testid="WEB-10.form"', false)->assertSee('Konto und Anmeldung');
        expect($page->headers->getCookies())->toBe([]);

        $this->post('/kontakt', ['name' => 'Jana Krüger', 'email' => 'Jana@Example.de', 'category' => 'vehicle', 'message' => 'Ich finde meinen Fahrzeugtyp nicht im Katalog.'])
            ->assertOk()->assertSee('Vorgangsnummer');

        $ticket = SupportTicket::query()->firstOrFail();
        expect($ticket->source)->toBe(SupportTicketSource::Web)
            ->and($ticket->user_id)->toBeNull()
            ->and($ticket->getAttribute('email'))->toBe('jana@example.de')
            ->and($ticket->getAttribute('subject'))->toBe('Ich finde meinen Fahrzeugtyp nicht im Katalog.')
            ->and($ticket->messages()->first()?->author_type)->toBe(TicketAuthorType::Guest);
        Mail::assertQueued(SupportTicketReceivedMail::class, fn (SupportTicketReceivedMail $mail): bool => $mail->hasTo('jana@example.de'));
    });

    it('renders errors with what was typed', function () {
        $this->post('/kontakt', ['name' => 'Jana', 'email' => 'kaputt', 'category' => 'vehicle', 'message' => 'Ich finde meinen Fahrzeugtyp nicht.'])
            ->assertUnprocessable()->assertSee('value="Jana"', false)->assertSee('Ich finde meinen Fahrzeugtyp nicht.');
        expect(SupportTicket::query()->count())->toBe(0);
    });

    it('limits five posts an hour per IP and three receipts a day per address', function () {
        $body = ['name' => 'Jana', 'email' => 'jana@example.de', 'category' => 'other', 'message' => 'Eine Frage an das Team, bitte.'];

        for ($i = 0; $i < 5; $i++) {
            $this->post('/kontakt', $body)->assertOk();
        }

        $this->post('/kontakt', $body)->assertStatus(429);
        expect(SupportTicket::query()->count())->toBe(5);
        Mail::assertQueued(SupportTicketReceivedMail::class, 3);
    });

    it('refuses a cross-site post and a failed Turnstile check', function () {
        $body = ['name' => 'Jana', 'email' => 'jana@example.de', 'category' => 'other', 'message' => 'Eine Frage an das Team, bitte.'];

        $this->withHeader('Origin', 'https://evil.example')->post('/kontakt', $body)->assertUnprocessable();

        config(['speedclub.services.turnstile_site_key' => 'site-key', 'speedclub.services.turnstile_secret' => 'secret']);
        Http::preventStrayRequests();
        Http::fake(['challenges.cloudflare.com/*' => Http::response(['success' => false])]);
        $this->withHeaders(['Origin' => config('app.url')])->post('/kontakt', $body)->assertUnprocessable();

        expect(SupportTicket::query()->count())->toBe(0);
    });
});
