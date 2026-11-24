<?php

use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Models\ConfigVersion;
use App\Services\Wrapped\WrappedReleases;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Mail;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../M35/Helpers.php';

/**
 * ADM-37 Season Wrapped releases (M5.9e admin, m5.9e contract §1, handover open issue 1): RemoteConfigSchema keeps `wrapped.releases`
 * only when a payload carries `wrapped`. The page hands the editor the live dates (editor.payload, liveReleases); the editor sends them
 * back with every save, so publishing a draft that changed only the versions keeps them. A bad date or season key is refused with its
 * field error; an empty map removes every date on purpose.
 */
beforeEach(function () {
    Mail::fake();
    m35FakeDisks();
    // CR-P5G-06: a new release lies at least a day ahead and after its season's end, so the dates below are set in early autumn.
    $this->travelTo(CarbonImmutable::parse('2026-09-15 12:00', 'Europe/Berlin'));
});

const ADM59E_RELEASES = ['2026-saison' => '2026-11-01T10:00:00+01:00', '2026-jahr' => '2027-01-05T10:00:00+01:00'];

function adm59eLivePayload(): array
{
    return ConfigVersion::query()->where('key', 'remote_config')->where('status', ConfigVersionStatus::Published)->orderByDesc('version')->firstOrFail()->payload;
}

it('hands the editor the live release dates', function () {
    $admin = adm32SignedIn('admin');
    adm35Publish($admin, ConfigKey::RemoteConfig, m35Remote(['wrapped' => ['releases' => ADM59E_RELEASES]]));

    $this->get('/admin/config/remote')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->component('Config/Remote')
        ->where('editor.payload.wrapped.releases', ['2026-jahr' => '2027-01-05T10:00:00+01:00', '2026-saison' => '2026-11-01T10:00:00+01:00'])
        ->where('liveReleases', ['2026-jahr' => '2027-01-05T10:00:00+01:00', '2026-saison' => '2026-11-01T10:00:00+01:00']));
});

it('keeps the release dates when a draft that only changes the versions is published', function () {
    $admin = adm32SignedIn('admin');
    adm35Publish($admin, ConfigKey::RemoteConfig, m35Remote(['wrapped' => ['releases' => ADM59E_RELEASES]]));

    // What the editor sends: the page's payload as it came, one version raised, Wrapped untouched.
    $payload = $this->get('/admin/config/remote')->inertiaProps('editor.payload');
    $payload['latest_version']['ios'] = '0.3.0';

    $this->post('/admin/config/remote/draft', ['payload' => $payload, 'revision' => null])->assertStatus(303)->assertSessionHasNoErrors();
    $draft = ConfigVersion::query()->where('key', 'remote_config')->where('status', ConfigVersionStatus::Draft)->sole();
    $this->post('/admin/config/remote/publish', ['reason' => adm32Reason(), 'revision' => $draft->revision])->assertSessionHas('success', 'config.flash.published');

    $live = adm59eLivePayload();
    app()->forgetInstance(WrappedReleases::class);
    expect($live['latest_version']['ios'])->toBe('0.3.0')
        ->and($live['wrapped']['releases'])->toBe(['2026-jahr' => '2027-01-05T10:00:00+01:00', '2026-saison' => '2026-11-01T10:00:00+01:00'])
        ->and(app(WrappedReleases::class)->releaseAt('2026-saison')?->toIso8601String())->toBe('2026-11-01T10:00:00+01:00');
});

it('stores a summer date with its own offset and sorts the seasons', function () {
    $admin = adm32SignedIn('admin');

    $this->post('/admin/config/remote/draft', ['payload' => m35Remote(['wrapped' => ['releases' => ['2027-saison' => '2027-11-01T10:00:00+01:00', '2026-jahr' => '2027-07-01T09:30+02:00']]])])
        ->assertSessionHasNoErrors();

    expect(ConfigVersion::query()->where('key', 'remote_config')->where('created_by', $admin->id)->sole()->payload['wrapped']['releases'])
        ->toBe(['2026-jahr' => '2027-07-01T09:30:00+02:00', '2027-saison' => '2027-11-01T10:00:00+01:00']);
});

it('refuses a bad date or season with the field error and saves nothing', function (array $releases, string $field) {
    $admin = adm32SignedIn('admin');

    $this->post('/admin/config/remote/draft', ['payload' => m35Remote(['wrapped' => ['releases' => $releases]])])
        ->assertStatus(302)
        ->assertSessionHasErrors([$field => __('content.remote.wrapped_release')]);

    expect(ConfigVersion::query()->where('key', 'remote_config')->where('created_by', $admin->id)->exists())->toBeFalse();
})->with([
    'no offset' => [['2027-saison' => '2027-11-01T10:00'], 'wrapped.releases.2027-saison'],
    'no time' => [['2027-saison' => '2027-11-01'], 'wrapped.releases.2027-saison'],
    'empty (row without a day)' => [['2027-saison' => ''], 'wrapped.releases.2027-saison'],
    'unknown season' => [['2027-winter' => '2027-11-01T10:00:00+01:00'], 'wrapped.releases.2027-winter'],
]);

it('refuses a new release less than a day ahead or before the season ends, and keeps a published one that has passed (CR-P5G-06)', function () {
    $admin = adm32SignedIn('admin');

    $this->post('/admin/config/remote/draft', ['payload' => m35Remote(['wrapped' => ['releases' => ['2026-saison' => '2026-09-16T09:00:00+02:00']]])])
        ->assertSessionHasErrors(['wrapped.releases.2026-saison' => __('content.remote.wrapped_release_season', ['date' => '31.10.2026 23:59'])]);
    $this->post('/admin/config/remote/draft', ['payload' => m35Remote(['wrapped' => ['releases' => ['2026-saison' => '2026-10-31T23:00:00+01:00']]])])
        ->assertSessionHasErrors('wrapped.releases.2026-saison');

    adm35Publish($admin, ConfigKey::RemoteConfig, m35Remote(['wrapped' => ['releases' => ADM59E_RELEASES]]));
    $this->travelTo(CarbonImmutable::parse('2026-11-10 12:00', 'Europe/Berlin'));

    // A season that ended, released today 18:00: too soon.
    $this->post('/admin/config/remote/draft', ['payload' => m35Remote(['wrapped' => ['releases' => [...ADM59E_RELEASES, '2026-saison' => '2026-11-10T18:00:00+01:00']]])])
        ->assertSessionHasErrors(['wrapped.releases.2026-saison' => __('content.remote.wrapped_release_soon', ['date' => '11.11.2026 12:00'])]);

    // The published 2026-saison (in the past now) stays as it is when the editor saves something else.
    $payload = m35Remote(['wrapped' => ['releases' => ADM59E_RELEASES]]);
    $payload['latest_version']['ios'] = '0.3.0';
    $this->post('/admin/config/remote/draft', ['payload' => $payload])->assertSessionHasNoErrors();
});

it('puts each refusal on its own row: the season one and the too-soon one, never on a valid row', function () {
    adm32SignedIn('admin');

    // 15 September 2026 (beforeEach): 2026-saison ends 31 October, so a date inside it is refused; 2027-saison in November 2027 is fine.
    $this->post('/admin/config/remote/draft', ['payload' => m35Remote(['wrapped' => ['releases' => [
        '2026-saison' => '2026-10-01T10:00:00+02:00',
        '2027-saison' => '2027-11-05T10:00:00+01:00',
    ]]])])
        ->assertSessionHasErrors(['wrapped.releases.2026-saison' => __('content.remote.wrapped_release_season', ['date' => '31.10.2026 23:59'])])
        ->assertSessionDoesntHaveErrors('wrapped.releases.2027-saison');

    // A calendar year that ended, released within the next day: too soon, on its row only.
    $this->travelTo(CarbonImmutable::parse('2027-01-10 12:00', 'Europe/Berlin'));
    $this->post('/admin/config/remote/draft', ['payload' => m35Remote(['wrapped' => ['releases' => [
        '2026-jahr' => '2027-01-10T20:00:00+01:00',
        '2027-saison' => '2027-11-05T10:00:00+01:00',
    ]]])])
        ->assertSessionHasErrors(['wrapped.releases.2026-jahr' => __('content.remote.wrapped_release_soon', ['date' => '11.01.2027 12:00'])])
        ->assertSessionDoesntHaveErrors('wrapped.releases.2027-saison');

    expect(ConfigVersion::query()->where('key', 'remote_config')->exists())->toBeFalse();
});

it('removes every date when the editor sends an empty map', function () {
    $admin = adm32SignedIn('admin');
    adm35Publish($admin, ConfigKey::RemoteConfig, m35Remote(['wrapped' => ['releases' => ADM59E_RELEASES]]));
    $draft = adm35Draft($admin, ConfigKey::RemoteConfig, m35Remote(['wrapped' => ['releases' => []]]));

    $this->post('/admin/config/remote/publish', ['reason' => adm32Reason(), 'revision' => $draft->revision])->assertSessionHas('success', 'config.flash.published');

    expect(adm59eLivePayload()['wrapped']['releases'])->toBe([]);
});
