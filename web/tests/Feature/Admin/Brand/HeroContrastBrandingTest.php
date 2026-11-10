<?php

use App\Actions\Admin\Brand\MeasureHeroContrast;
use App\Actions\Admin\Config\PublishConfigVersion;
use App\Actions\Admin\Config\SaveConfigDraft;
use App\Enums\BrandAssetKind;
use App\Enums\ConfigKey;
use App\Services\Brand\AccentSets;
use App\Services\Brand\HeroContrast;
use App\Services\PublicPages\OgImages;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Config/ConfigHelpers.php';

/**
 * The hero contrast rule (ADR-129/151/152, FS-1) on the seed photos, the branding draft that refuses a failing hero, the accent sets
 * of the token palette, and what app-config answers after a branding publish.
 */
beforeEach(function () {
    m35FakeDisks();
    $this->editor = m31Staff('content_editor');
});

it('passes the bundled Welcome photo and its dark source, and refuses bright seed photos', function (string $photo, bool $passes) {
    $result = app(HeroContrast::class)->measure((string) file_get_contents(m35SeedPhoto($photo)), 0.5, 0.5);

    expect($result->passes())->toBe($passes)->and($result->textRatio)->toBeGreaterThanOrEqual(4.5);
})->with([
    'bundled Welcome hero' => ['welcome-hero.jpg', true],
    'generic-exterior-01 (its source)' => ['generic-exterior-01.jpg', true],
    'nissan-r35-01 (night)' => ['nissan-r35-01.jpg', true],
    'bmw-e92-01 (bright behind the logo)' => ['bmw-e92-01.jpg', false],
    'toyota-a80-01 (bright behind the logo)' => ['toyota-a80-01.jpg', false],
]);

it('refuses a white photo and passes a black one; text on the solid scrim always reaches 4.5:1', function () {
    $make = function (int $grey): string {
        $image = imagecreatetruecolor(1080, 1920);
        imagefill($image, 0, 0, imagecolorallocate($image, $grey, $grey, $grey));
        ob_start();
        imagejpeg($image);

        return (string) ob_get_clean();
    };

    $white = app(HeroContrast::class)->measure($make(255), 0.5, 0.5);
    $black = app(HeroContrast::class)->measure($make(0), 0.5, 0.5);

    expect($white->passes())->toBeFalse()->and($white->logoRatio)->toBeLessThan(4.5)->and($white->textRatio)->toBeGreaterThanOrEqual(4.5)
        ->and($black->passes())->toBeTrue();
});

it('refuses a branding draft whose hero fails at its focal point, and accepts one that passes', function () {
    $bright = m35Asset(BrandAssetKind::Hero, 'bmw-e92-01.jpg');
    $dark = m35Asset(BrandAssetKind::Hero, 'welcome-hero.jpg');

    expect(fn () => app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::Branding, m35Branding(['heroes' => ['welcome' => ['asset_id' => $bright->id]]]), null))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey('heroes.welcome.asset_id')
            ->and($e->errors()['heroes.welcome.asset_id'][0])->toContain('4,5:1'));

    $draft = app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::Branding, m35Branding(['heroes' => ['welcome' => ['asset_id' => $dark->id, 'focal_x' => 0.4, 'focal_y' => 0.6]]]), null);
    expect($draft->payload['heroes']['welcome'])->toBe(['asset_id' => $dark->id, 'focal_x' => 0.4, 'focal_y' => 0.6]);

    expect(app(MeasureHeroContrast::class)->handle($this->editor, $bright, 0.5, 0.5)->passes())->toBeFalse();
});

it('accepts only an asset of the slot\'s kind', function () {
    $hero = m35Asset(BrandAssetKind::Hero);

    expect(fn () => app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::Branding, m35Branding(['logos' => ['wordmark_white' => $hero->id]]), null))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey('logos.wordmark_white'));
});

it('offers exactly the accent sets of the token palette, no free colour', function () {
    $tokens = json_decode((string) file_get_contents(base_path('../design/tokens/tokens.json')), true);

    expect(app(AccentSets::class)->keys())->toBe(array_keys($tokens['accentPalette']['sets']))
        ->and(app(AccentSets::class)->defaultKey())->toBe($tokens['accentPalette']['default']);

    expect(fn () => app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::Branding, m35Branding(['accent_set' => '#FF00FF']), null))
        ->toThrow(fn (ValidationException $e) => expect($e->errors())->toHaveKey('accent_set'));

    $draft = app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::Branding, m35Branding(['accent_set' => 'default']), null);
    expect($draft->payload['accent_set'])->toBe('signalRed');
});

it('serves the published branding in app-config: hero with focal point and variants, logos, accent, OG', function () {
    $hero = m35Asset(BrandAssetKind::Hero);
    $og = m35Asset(BrandAssetKind::Og, 'generic-exterior-01.jpg');

    app(SaveConfigDraft::class)->handle($this->editor, ConfigKey::Branding, m35Branding([
        'heroes' => ['welcome' => ['asset_id' => $hero->id, 'focal_x' => 0.5, 'focal_y' => 0.62]],
        'og_default' => $og->id,
        'accent_set' => 'racingBlue',
        'default_theme' => 'black',
    ]), null);
    app(PublishConfigVersion::class)->handle($this->editor, ConfigKey::Branding, m35Reason(), 1);

    $response = $this->getJson('/api/v1/app-config')->assertOk()
        ->assertJsonPath('data.branding.accent_set', 'racingBlue')
        ->assertJsonPath('data.branding.default_theme', 'black')
        ->assertJsonPath('data.branding.heroes.welcome.focal_y', 0.62)
        ->assertJsonPath('data.branding.heroes.welcome.blurhash', $hero->blurhash)
        ->assertJsonPath('data.branding.heroes.landing', null)
        ->assertJsonPath('data.branding.logos.wordmark_white', url('/brand/logo-wide-white-640.webp'));

    expect($response->json('data.branding.welcome_hero'))->toBe(url('/storage/'.$hero->variants[1080]))
        ->and(array_column($response->json('data.branding.heroes.welcome.variants'), 'width'))->toBe([320, 640, 1080, 1170])
        ->and($response->json('data.branding.og_default'))->toBe(url('/storage/'.$og->og_path))
        ->and(app(OgImages::class)->defaultUrl())->toBe(url('/storage/'.$og->og_path));
});
