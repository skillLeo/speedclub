<?php

use App\Models\User;
use Illuminate\Support\Facades\Vite;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * Lighthouse budgets of 05_ARCHITECTURE section 21, the parts a render can show: the stylesheet arrives with the page, and the hero
 * gets the bandwidth first. The measurement itself is `npm --prefix web run lhci`.
 */
beforeEach(function () {
    // The real build (the suite fakes Vite, and the fake inlines nothing).
    $this->withVite();
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc']);
    $this->vehicle = publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Skyline GT-R']);
});

it('inlines the built stylesheet in a nonced style block and links no stylesheet', function (string $page) {
    $path = $page === 'vehicle' ? '/v/'.$this->vehicle->canonicalSlug() : ($page === 'member' ? '/u/lukas.sc' : '/');
    $response = $this->get($path)->assertOk();
    $html = (string) $response->getContent();
    preg_match("~style-src [^;]*'nonce-([A-Za-z0-9+/=_-]+)'~", (string) $response->headers->get('Content-Security-Policy'), $nonce);
    $css = Vite::content('resources/css/public.css');

    expect($css)->not->toBe('');

    expect($nonce)->not->toBeEmpty()
        ->and($html)->toContain('<style nonce="'.$nonce[1].'">'.$css.'</style>')
        ->not->toMatch('~<link[^>]+rel="stylesheet"~')
        // The fonts it names are its own build's files.
        ->and($css)->toContain('/build/assets/inter-latin-400-normal-');
})->with(['home', 'vehicle', 'member']);

it('keeps the wordmark in the landing hero behind the photo in the queue', function () {
    $html = (string) $this->get('/')->assertOk()->getContent();

    expect($html)->toMatch('~<img[^>]+fetchpriority="low"[^>]+data-testid="WEB-03.logo"~')
        ->toMatch('~<img[^>]+fetchpriority="high"[^>]+class="sc-photo sc-ph-landing-hero~');
});

it('loads the first garage card of a member page without lazy loading, and the others lazily', function () {
    publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Silvia']);

    $html = (string) $this->get('/u/lukas.sc')->assertOk()->getContent();
    preg_match_all('~<img\b[^>]*\babsolute inset-0\b[^>]*>~', $html, $cards);

    expect($cards[0])->toHaveCount(2)
        ->and($cards[0][0])->not->toContain('loading="lazy"')->not->toContain('fetchpriority')
        ->and($cards[0][1])->toContain('loading="lazy"')->toContain('fetchpriority="low"');
});
