<?php

use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Mail\ReportReceivedMail;
use App\Models\Report;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Qr\QrCodes;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;

require_once __DIR__.'/ModerationTestHelpers.php';

/**
 * WEB-09 /melden (m2.6-contract §3): sessionless, a SPEED CLUB public URL only, the good-faith checkbox, Turnstile when configured, a
 * per-IP limit, the confirmation page and mail, refused cross-site posts, the footer link.
 */
beforeEach(function () {
    // German first: the test client asks for English otherwise.
    $this->withHeaders(['Accept-Language' => 'de']);
    $this->withoutDefer();
    Mail::fake();
    $this->owner = User::factory()->create(['username' => 'paul.roadster']);
    $this->vehicle = modVehicle($this->owner);
});

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function webReport(string $url, array $overrides = []): array
{
    return array_replace([
        'url' => $url,
        'reason' => 'illegal',
        'sub_reason' => 'street_racing',
        'details' => 'Im Text wird zu einem Rennen auf der B9 aufgerufen.',
        'good_faith' => '1',
    ], $overrides);
}

function webPost(string $url, array $overrides = [], array $headers = ['Sec-Fetch-Site' => 'same-origin']): TestResponse
{
    return test()->withHeaders($headers)->post('/melden', webReport($url, $overrides));
}

it('shows the form without a session, a cookie or a session row', function () {
    $response = $this->get('/melden')->assertOk()->assertSee('Inhalt melden')->assertSee('name="good_faith"', false);

    expect($response->headers->getCookies())->toBe([])
        ->and(DB::table('sessions')->count())->toBe(0);
    $this->get('/melden?lang=en')->assertOk()->assertSee('Report content');
});

it('files a web notice for a build and redirects to the confirmation page', function () {
    $response = webPost(config('app.url').'/v/'.$this->vehicle->slug, ['email' => 'Hinweis@Example.org', 'name' => 'Jana Weber']);

    $response->assertStatus(303)->assertRedirect(url('/melden/gesendet'));
    expect($response->headers->getCookies())->toBe([]);

    $report = Report::query()->sole();
    expect($report->source)->toBe(ReportSource::WebForm)
        ->and($report->reporter_id)->toBeNull()
        ->and($report->target_type)->toBe(ReportTargetType::Vehicle)
        ->and($report->target_id)->toBe($this->vehicle->id)
        ->and($report->good_faith)->toBeTrue()
        ->and($report->contact_email)->toBe('hinweis@example.org')
        ->and($report->contact_name)->toBe('Jana Weber')
        ->and($report->getAttribute('contact_locale'))->toBe('de');

    Mail::assertSent(ReportReceivedMail::class, fn (ReportReceivedMail $mail) => $mail->hasTo('hinweis@example.org') && $mail->reference === $report->id);
    $this->get('/melden/gesendet')->assertOk()->assertSee('Danke für deine Meldung');
});

it('sends no mail without an address', function () {
    webPost(config('app.url').'/u/paul.roadster', ['reason' => 'harassment', 'sub_reason' => null])->assertStatus(303);

    Mail::assertNothingSent();
    expect(Report::query()->sole()->target_type)->toBe(ReportTargetType::Member);
});

it('takes a QR address, the app address and the address without a scheme', function (Closure $url) {
    webPost($url($this->vehicle))->assertStatus(303);

    expect(Report::query()->sole()->target_id)->toBe($this->vehicle->id);
})->with([
    'qr code' => [fn ($vehicle) => config('app.url').'/c/'.app(QrCodes::class)->ensureActive($vehicle)->code],
    'member web app' => [fn ($vehicle) => config('app.url').'/app/v/'.$vehicle->slug],
    'without scheme' => [fn ($vehicle) => parse_url(config('app.url'), PHP_URL_HOST).'/v/'.$vehicle->slug.'?ref=share'],
]);

it('refuses an address that is not a public SPEED CLUB page, with help', function (Closure $url, string $message) {
    webPost($url($this->vehicle, $this->owner))->assertStatus(422)->assertSee($message);

    expect(Report::query()->count())->toBe(0);
})->with([
    'another site' => [fn ($vehicle) => 'https://evil.example/v/'.$vehicle->slug, 'Gib die Adresse einer Seite von SPEED CLUB an'],
    'another path' => [fn () => config('app.url').'/impressum', 'Gib die Adresse einer Seite von SPEED CLUB an'],
    'a lookalike host' => [fn ($vehicle) => 'https://'.parse_url(config('app.url'), PHP_URL_HOST).'.evil.example/v/'.$vehicle->slug, 'Gib die Adresse einer Seite von SPEED CLUB an'],
    'credentials in the address' => [fn ($vehicle) => 'https://user:pass@'.parse_url(config('app.url'), PHP_URL_HOST).'/v/'.$vehicle->slug, 'Gib die Adresse einer Seite von SPEED CLUB an'],
    'unknown build' => [fn () => config('app.url').'/v/bmw-m3-zzzzzzzz', 'Diese Seite gibt es nicht'],
    'private build' => [fn ($vehicle, $owner) => config('app.url').'/v/'.Vehicle::factory()->private()->create(['owner_id' => $owner->id])->slug, 'Diese Seite gibt es nicht'],
    'suspended member' => [fn () => config('app.url').'/u/'.User::factory()->suspended()->create()->username, 'Diese Seite gibt es nicht'],
]);

it('validates the fields and keeps what was typed', function (array $overrides, string $message) {
    webPost(config('app.url').'/v/'.$this->vehicle->slug, $overrides)->assertStatus(422)
        ->assertSee($message)
        ->assertSee('value="'.config('app.url').'/v/'.$this->vehicle->slug.'"', false);
})->with([
    'no good faith' => [['good_faith' => null], 'Bestätige, dass deine Angaben nach bestem Wissen'],
    'no explanation' => [['details' => ''], 'Beschreibung'],
    'illegal without kind' => [['sub_reason' => ''], 'Wähl aus, welcher Rechtsverstoß es ist.'],
    'unknown reason' => [['reason' => 'rude'], 'Grund'],
    'bad e-mail' => [['email' => 'keine-adresse'], 'E-Mail-Adresse'],
    'explanation too long' => [['details' => str_repeat('x', 1001)], 'höchstens 1000 Zeichen'],
]);

it('refuses a post from another site without a CSRF token or session', function (array $headers) {
    webPost(config('app.url').'/v/'.$this->vehicle->slug, [], $headers)->assertStatus(422)->assertSee('Diese Meldung kam nicht von unserer Seite');

    expect(Report::query()->count())->toBe(0);
})->with([
    'sec-fetch-site cross-site' => [['Sec-Fetch-Site' => 'cross-site']],
    'sec-fetch-site same-site' => [['Sec-Fetch-Site' => 'same-site']],
    'foreign origin' => [['Origin' => 'https://evil.example']],
]);

it('takes a post from its own origin and from a client that sends neither header', function () {
    webPost(config('app.url').'/v/'.$this->vehicle->slug, [], ['Origin' => rtrim(config('app.url'), '/')])->assertStatus(303);
    webPost(config('app.url').'/u/paul.roadster', [], [])->assertStatus(303);
});

it('checks Turnstile when configured, without sending the visitor IP', function () {
    config(['speedclub.services.turnstile_site_key' => 'site-key', 'speedclub.services.turnstile_secret' => 'secret']);
    Http::fake(['challenges.cloudflare.com/*' => Http::sequence()->push(['success' => false])->push(['success' => true, 'hostname' => parse_url(config('app.url'), PHP_URL_HOST), 'action' => 'report'])]);

    $this->get('/melden')->assertSee('data-sitekey="site-key"', false);
    webPost(config('app.url').'/v/'.$this->vehicle->slug, ['cf-turnstile-response' => 'bad'])->assertStatus(422)->assertSee('Sicherheitsprüfung');
    webPost(config('app.url').'/v/'.$this->vehicle->slug, ['cf-turnstile-response' => 'good'])->assertStatus(303);

    Http::assertSent(fn ($request) => ! array_key_exists('remoteip', $request->data()));
    expect(Report::query()->count())->toBe(1);
});

it('limits an address to 20 notices a day and answers a page', function () {
    $members = User::factory()->count(20)->create();

    foreach ($members as $member) {
        webPost(config('app.url').'/u/'.$member->username)->assertStatus(303);
    }

    webPost(config('app.url').'/u/paul.roadster')->assertStatus(429)->assertSee('Meldungen');
});

it('lets a second notifier join the open case of the target', function () {
    $member = modReport(User::factory()->create(), ReportTargetType::Vehicle, $this->vehicle->id);
    webPost(config('app.url').'/v/'.$this->vehicle->slug)->assertStatus(303);
    webPost(config('app.url').'/v/'.$this->vehicle->slug)->assertStatus(303);

    expect(Report::query()->pluck('case_id')->unique()->all())->toBe([$member->case_id]);
});

it('is linked from the footer of every public page', function () {
    $this->get('/')->assertOk()->assertSee('data-testid="WEB.footer.report"', false)->assertSee(url('/melden'), false);
});
