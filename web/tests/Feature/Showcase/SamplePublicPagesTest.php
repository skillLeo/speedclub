<?php

use App\Models\FeatureFlag;
use App\Models\User;
use App\Services\Showcase\SampleContent;

require_once __DIR__.'/../Home/HomeTestHelpers.php';

/**
 * M4.2, 09 §8.19: the public Blade pages (WEB-01, WEB-02, WEB-03) mark sample content with the "Beispiel" badge (EN "Sample"), the
 * SPEED CLUB Editorial account with "Editorial", keep sample pages out of search engines (noindex) and show no numbers for a sample
 * account. A real page next to it shows none of that.
 */
beforeEach(function () {
    FeatureFlag::query()->updateOrCreate(['key' => SampleContent::FLAG], ['enabled' => true]);
    config(['speedclub.public_pages.allow_indexing' => true]);

    $this->editorial = User::factory()->create(['username' => 'speedclub.editorial', 'display_name' => 'SPEED CLUB Editorial', 'is_sample' => true, 'is_editorial' => true]);
    $this->sample = homeBuild($this->editorial, 1, ['is_sample' => true]);
    $this->realOwner = User::factory()->create(['username' => 'echt.fahrer']);
    $this->real = homeBuild($this->realOwner, 2);
});

it('badges a sample vehicle page, names the Editorial owner and keeps it out of search engines', function () {
    $html = $this->get('/v/'.$this->sample->slug.'?lang=de')->assertOk()->getContent();

    expect($html)->toContain('data-testid="WEB-01.sampleBadges"')
        ->toContain('data-testid="WEB-01.sampleBadges.sample">Beispiel<')
        ->toContain('data-testid="WEB-01.sampleBadges.editorial">Editorial<')
        ->toContain(e(__('public.sample.vehicle_note', [], 'de')))
        ->toContain('<meta name="robots" content="noindex">');
});

it('says Sample in English', function () {
    $html = $this->get('/v/'.$this->sample->slug.'?lang=en')->assertOk()->getContent();

    expect($html)->toContain('data-testid="WEB-01.sampleBadges.sample">Sample<')
        ->toContain(e(__('public.sample.vehicle_note', [], 'en')));
});

it('badges a sample member page, shows no numbers and badges the cards of its garage', function () {
    $html = $this->get('/u/speedclub.editorial?lang=de')->assertOk()->getContent();

    expect($html)->toContain('data-testid="WEB-02.sampleBadges.sample">Beispiel<')
        ->toContain('data-testid="WEB-02.sampleBadges.editorial">Editorial<')
        ->toContain('data-testid="WEB-02.vehicle.sample.sample"')
        ->toContain('<meta name="robots" content="noindex">')
        ->not->toContain('data-testid="WEB-02.stats"');
});

it('shows nothing of it on a real member and a real build', function () {
    $member = $this->get('/u/echt.fahrer')->assertOk()->getContent();
    $vehicle = $this->get('/v/'.$this->real->slug)->assertOk()->getContent();

    expect($member)->toContain('data-testid="WEB-02.stats"')
        ->not->toContain('sampleBadges')
        ->not->toContain('<meta name="robots" content="noindex">')
        ->and($vehicle)->not->toContain('sampleBadges')
        ->not->toContain('WEB-01.sampleNote')
        ->not->toContain('<meta name="robots" content="noindex">');
});

it('badges a sample build featured on the landing page', function () {
    config(['speedclub.public_pages.featured_slug' => $this->sample->slug]);

    $html = $this->get('/?lang=de')->assertOk()->getContent();

    expect($html)->toContain('data-testid="WEB-03.featuredSample.sample">Beispiel<')
        ->toContain('data-testid="WEB-03.featuredSample.editorial">Editorial<');
});
