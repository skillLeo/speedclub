<?php

use App\Models\User;
use App\Support\BrandFiles;
use App\Support\PublicIcons;
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
        // The fonts it names are its own build's files: the 2.0 faces (09 §4.2), not the package fonts of v1 (WebFontsTest pins the full set).
        ->and($css)->toMatch('~/build/assets/Inter-Regular-[A-Za-z0-9_-]+\.woff2~')
        ->toMatch('~/build/assets/ArchivoSemiExpanded-SemiBold-[A-Za-z0-9_-]+\.woff2~')
        ->not->toContain('inter-latin-');
})->with(['home', 'vehicle', 'member']);

it('puts the landing hero photo first in the queue, as the only high-priority image, and draws no hero logo (R4DQ-61)', function () {
    $html = (string) $this->get('/')->assertOk()->getContent();

    expect($html)->toMatch('~<img[^>]+fetchpriority="high"[^>]+class="sc-photo sc-ph-landing-hero~')
        ->and(preg_match_all('~<img[^>]+fetchpriority="high"~', $html))->toBe(1)
        ->and(substr_count($html, 'rel="preload" as="image"'))->toBe(1)
        ->and($html)->not->toContain('data-testid="WEB-03.logo"');
});

it('loads the cover of a member page as its only eager photo, and defers every garage card, the first included', function () {
    publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Silvia']);

    $html = (string) $this->get('/u/lukas.sc')->assertOk()->getContent();
    $live = (string) preg_replace('~<noscript>.*?</noscript>~s', '', $html);
    preg_match_all('~<img\b[^>]*\bclass="sc-photo[^"]*"[^>]*>~', $live, $photos);
    preg_match_all('~<img\b[^>]*\babsolute inset-0\b[^>]*>~', $live, $cards);
    preg_match_all('~<noscript><img\b[^>]*\babsolute inset-0\b[^>]*></noscript>~', $html, $copies);

    // ADR-469 (DQ-1234): every member page opens on a cover (here the brand stage, as both builds have one photo). It is the page's
    // LCP and its one eager photo: the only high-priority image, the only preload, the only photo outside <noscript> that names its
    // file. Since the M4.18 LCP fix the first garage card is no exception (eager, its 1080 file cost /u/jann.ptrs about 890 ms of
    // LCP): every card is a deferred placeholder (data-sc-src, lazy, the transparent pixel) with its <noscript> copy, sized to the
    // card's column (inside the phone gutters, not 100vw).
    expect(preg_match_all('~<img[^>]+fetchpriority="high"~', $html))->toBe(1)
        ->and($html)->toMatch('~<img[^>]+fetchpriority="high"[^>]+class="sc-photo sc-ph-stage-empty~')
        ->and(substr_count($html, 'rel="preload" as="image"'))->toBe(1)
        ->and($cards[0])->toHaveCount(2)
        ->and($copies[0])->toHaveCount(2);

    foreach ($photos[0] as $photo) {
        if (str_contains($photo, 'fetchpriority="high"')) {
            expect($photo)->toContain('sc-ph-stage-empty')->toContain(' srcset=')->not->toContain('loading="lazy"')->not->toContain('data-sc-src');
        } else {
            expect($photo)->toContain('data-sc-src="')->toContain('src="data:image/gif;base64,')->not->toContain('fetchpriority');
        }
    }

    foreach ($cards[0] as $card) {
        expect($card)->toContain('loading="lazy"')->toContain('data-sc-src="')->toContain('data-sc-srcset="')
            ->toContain('src="data:image/gif;base64,')->not->toContain(' srcset=')->not->toContain('fetchpriority')
            ->toMatch('~ sizes="[^"]*, calc\(100vw - 40px\)"~');
    }

    foreach ($copies[0] as $copy) {
        expect($copy)->toContain('loading="lazy"')->toContain(' srcset=')->not->toContain('data-sc-src')->not->toContain('fetchpriority')
            ->toMatch('~ sizes="[^"]*, calc\(100vw - 40px\)"~');
    }
});

it('fetches nothing but the hero before the page has loaded (M4.16 LCP)', function () {
    $html = (string) $this->get('/')->assertOk()->getContent();
    // Outside <noscript>, every photo but the hero names its file only in data-sc-src.
    $live = (string) preg_replace('~<noscript>.*?</noscript>~s', '', $html);
    preg_match_all('~<img\b[^>]*\bclass="sc-photo[^"]*"[^>]*>~', $live, $photos);

    expect($photos[0])->not->toBeEmpty();

    foreach ($photos[0] as $photo) {
        if (str_contains($photo, 'fetchpriority="high"')) {
            expect($photo)->toContain('sc-ph-landing-hero')->not->toContain('loading="lazy"');
        } else {
            expect($photo)->toContain('data-sc-src="')->toContain('src="data:image/gif;base64,')->not->toContain('fetchpriority');
        }
    }

    expect(substr_count($html, 'rel="preload" as="image"'))->toBe(1);
});

it('carries in its sprites exactly the symbols the page uses, not every glyph (M4.18 LCP: about 9 KB less HTML on the critical path)', function (string $page) {
    $path = $page === 'vehicle' ? '/v/'.$this->vehicle->canonicalSlug() : ($page === 'member' ? '/u/lukas.sc' : '/');
    $html = (string) $this->get($path)->assertOk()->getContent();
    preg_match_all('~<use href="#([^"]+)"~', $html, $uses);
    preg_match_all('~<symbol id="([^"]+)"~', $html, $symbols);
    $used = array_values(array_unique($uses[1]));
    sort($used);
    $printed = $symbols[1];
    sort($printed);

    expect($used)->not->toBeEmpty()
        ->and($printed)->toBe($used)
        ->and(substr_count(view('components.icons.phosphor-sprite')->render(), '<symbol id="'))->toBeGreaterThan(count($printed));
})->with(['home', 'vehicle', 'member']);

it('prints no sprite markup for a page without icons, and only the symbols a page used otherwise', function () {
    expect((string) PublicIcons::sprite('components.icons.phosphor-sprite'))->toBe('');

    PublicIcons::use('ph-wrench');
    expect((string) PublicIcons::sprite('components.icons.phosphor-sprite'))->toContain('<symbol id="ph-wrench"')
        ->not->toContain('<symbol id="ph-arrow-right"');
});

it('gives the wordmark a 2x file beside the 3x one, so a phone does not load 3x before the hero has painted (M5 gate LCP)', function (string $page) {
    $path = $page === 'vehicle' ? '/v/'.$this->vehicle->canonicalSlug() : ($page === 'member' ? '/u/lukas.sc' : '/');
    $html = (string) $this->get($path)->assertOk()->getContent();
    preg_match_all('~<img\b[^>]*\bclass="sc-logo-on-(dark|light) sc-wordmark"[^>]*>~', $html, $marks, PREG_SET_ORDER);

    // Top bar and footer, each in both tones; every one lazy, 121 CSS px wide (client logo of round 3), the 242 file first and the 320 file as src and 3x.
    expect($marks)->toHaveCount(4);

    foreach ($marks as [$img, $theme]) {
        $tone = $theme === 'dark' ? 'white' : 'black';

        expect($img)->toContain('src="'.BrandFiles::asset("brand/logo-wide-{$tone}-320.webp").'"')
            ->toContain('srcset="'.BrandFiles::asset("brand/logo-wide-{$tone}-242.webp").' 242w, '.BrandFiles::asset("brand/logo-wide-{$tone}-320.webp").' 320w"')
            ->toContain('sizes="121px"')
            ->toContain('width="121" height="32"')
            ->toContain('loading="lazy"')
            ->not->toContain('fetchpriority');
    }

    foreach (['white', 'black'] as $tone) {
        foreach ([242 => 64, 320 => 85] as $width => $height) {
            $size = getimagesize(public_path("brand/logo-wide-{$tone}-{$width}.webp"));

            expect($size)->not->toBeFalse()
                ->and([$size[0], $size[1]])->toBe([$width, $height]);
        }
    }

    expect(filesize(public_path('brand/logo-wide-white-242.webp')))->toBeLessThan((int) (filesize(public_path('brand/logo-wide-white-320.webp')) * 0.6));
})->with(['home', 'vehicle', 'member']);

it('inlines only the tokens the page reads, and every token it reads is there (scripts/vite-prune-tokens.mjs)', function (string $page) {
    $path = $page === 'vehicle' ? '/v/'.$this->vehicle->canonicalSlug() : ($page === 'member' ? '/u/lukas.sc' : '/');
    $html = (string) $this->get($path)->assertOk()->getContent();
    preg_match_all('~<style nonce="[^"]+">(.*?)</style>~s', $html, $blocks);
    $css = implode("\n", $blocks[1]);
    preg_match_all('~[{;](--sc-[a-z0-9-]+)\s*:~', $css, $defined);
    preg_match_all('~var\(\s*(--sc-[a-z0-9-]+)~', $css, $read);
    $defined = array_unique($defined[1]);

    // Nothing the page's stylesheet, its photo rules or its layout rules (spec strip, display titles) read is missing.
    expect(array_values(array_diff(array_unique($read[1]), $defined)))->toBe([])
        // The type roles and the theme colours of every theme are there.
        ->and($defined)->toContain('--sc-type-display-title-size', '--sc-type-display-title-shrink-size', '--sc-color-bg-canvas', '--sc-gutter')
        // The app's own tokens are not: springs, chat bubbles, z-indices, the tab bar.
        ->and($defined)->not->toContain('--sc-spring-default-duration')
        ->not->toContain('--sc-color-bubble-own-bg')
        ->not->toContain('--sc-z-sheet')
        ->not->toContain('--sc-tabbar');
})->with(['home', 'vehicle', 'member']);

it('serves the icons a browser fetches after every first load as indexed PNGs (build-brand.mjs, lossless)', function () {
    $pngs = ['apple-touch-icon.png' => 180, 'favicon-32.png' => 32, 'icon-192.png' => 192, 'icon-512.png' => 512];

    foreach ($pngs as $file => $size) {
        $bytes = (string) file_get_contents(public_path($file));

        // IHDR: width, height, bit depth 8, colour type 3 (indexed).
        expect(substr($bytes, 0, 8))->toBe("\x89PNG\r\n\x1a\n")
            ->and(unpack('Nwidth/Nheight/Cdepth/Ctype', substr($bytes, 16, 10)))->toBe(['width' => $size, 'height' => $size, 'depth' => 8, 'type' => 3]);
    }

    $ico = (string) file_get_contents(public_path('favicon.ico'));
    $frames = unpack('v', substr($ico, 4, 2))[1];

    expect($frames)->toBe(3);

    for ($i = 0; $i < $frames; $i++) {
        $entry = unpack('Csize/x/x/x/x2/x2/Vlength/Voffset', substr($ico, 6 + $i * 16, 16));
        $frame = substr($ico, $entry['offset'], $entry['length']);

        expect(substr($frame, 0, 8))->toBe("\x89PNG\r\n\x1a\n")
            ->and(ord($frame[25]))->toBe(3)
            ->and(unpack('N', substr($frame, 16, 4))[1])->toBe([16, 32, 48][$i]);
    }
});
