<?php

use App\Enums\LegalDocumentKey;
use App\Models\LegalDocument;
use App\Models\User;
use Illuminate\Foundation\Vite;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\Vite as ViteFacade;
use Illuminate\Support\HtmlString;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * M4.1 (ADR-402, 09 §4.2): the Blade pages and the admin load the 2.0 faces from resources/fonts/2.0, preload exactly two of them each,
 * and the web side holds no other font file than these and the TTFs the image and PDF renderers draw with.
 */
beforeEach(function () {
    ViteFacade::clearResolvedInstance();
    // The asset path instead of a hashed build URL, so the test needs no Vite build and still sees which file is preloaded. A page
    // render gets no inlined stylesheet and no script tags, as under the suite's own fake.
    $this->swap(Vite::class, new class extends Vite
    {
        public function __invoke($entrypoints, $buildDirectory = null)
        {
            return new HtmlString('');
        }

        public function asset($asset, $buildDirectory = null)
        {
            return '/build/'.$asset;
        }

        public function content($asset, $buildDirectory = null)
        {
            return '';
        }

        public function isRunningHot()
        {
            return false;
        }
    });
});

/**
 * @return list<string> the woff2 files a page preloads, in order
 */
function preloadedFonts(string $html): array
{
    preg_match_all('~<link rel="preload" as="font" type="font/woff2" crossorigin href="/build/([^"]+)">~', $html, $links);

    return $links[1];
}

it('preloads exactly two faces per surface, each a file that exists', function (string $tag, array $faces) {
    $html = Blade::render($tag);

    expect(preloadedFonts($html))->toBe($faces)
        ->and(substr_count($html, '<link'))->toBe(2);

    foreach ($faces as $face) {
        expect(base_path($face))->toBeFile();
    }
})->with([
    // Inter Display SemiBold: the face of t-title-1/t-title-2, the h1 of every public page but two. It is the default.
    'public, title' => ['<x-font-preload />', ['resources/fonts/2.0/Inter-Regular.woff2', 'resources/fonts/2.0/InterDisplay-SemiBold.woff2']],
    'public, title (explicit)' => ['<x-font-preload display="title" />', ['resources/fonts/2.0/Inter-Regular.woff2', 'resources/fonts/2.0/InterDisplay-SemiBold.woff2']],
    // Archivo SemiExpanded SemiBold: t-display-title, the car's name (WEB-01) and the brand claim (WEB-03).
    'public, marque' => ['<x-font-preload display="marque" />', ['resources/fonts/2.0/Inter-Regular.woff2', 'resources/fonts/2.0/ArchivoSemiExpanded-SemiBold.woff2']],
    'admin' => ['<x-font-preload surface="admin" />', ['resources/fonts/2.0/Inter-Regular.woff2', 'resources/fonts/2.0/Inter-Medium.woff2']],
]);

it('preloads, on every public page family, the face of that page\'s h1 role beside Inter Regular', function (string $family) {
    seedModSchema();
    $owner = User::factory()->create(['username' => 'lukas.sc', 'display_name' => 'Lukas Scholz']);
    $vehicle = publishedVehicle($owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Skyline GT-R']);
    LegalDocument::factory()->published()->create(['key' => LegalDocumentKey::Imprint, 'locale' => 'de', 'body_md' => 'Text.']);
    config(['speedclub.spa.index' => storage_path('framework/testing/no-export/index.html')]);

    $path = match ($family) {
        'home' => '/',
        'vehicle' => '/v/'.$vehicle->canonicalSlug(),
        'member' => '/u/lukas.sc',
        'legal' => '/impressum',
        'contact' => '/kontakt',
        'report' => '/melden',
        'account-deletion' => '/konto-loeschen',
        'get-app' => '/app-laden',
        'email-action' => '/email/verify',
        'state' => '/c/ZZZZZZZZ',
        'app-not-exported' => '/app',
    };
    $html = (string) $this->withHeader('Accept-Language', 'de')->get($path)->getContent();

    // The role of the page's one h1, and the face the generated type scale gives it (09 §4.2 type roles).
    preg_match_all('~<h1\b[^>]*\bclass="[^"]*\b(t-display-title|t-title-1|t-title-2)\b~', $html, $roles);
    expect($roles[1])->toHaveCount(1);
    $face = $roles[1][0] === 't-display-title' ? 'ArchivoSemiExpanded-SemiBold' : 'InterDisplay-SemiBold';

    expect(preloadedFonts($html))->toBe(['resources/fonts/2.0/Inter-Regular.woff2', 'resources/fonts/2.0/'.$face.'.woff2'])
        ->and(substr_count($html, 'as="font"'))->toBe(2);
})->with(['home', 'vehicle', 'member', 'legal', 'contact', 'report', 'account-deletion', 'get-app', 'email-action', 'state', 'app-not-exported']);

it('gives t-display-title the Archivo SemiExpanded SemiBold face and t-title-1/t-title-2 the Inter Display SemiBold face', function (string $role, string $family) {
    // The mapping the page test above relies on, read from the generated public type scale (tokens.json → build-tokens.mjs).
    $css = (string) file_get_contents(resource_path('css/tokens.generated.css'));

    expect(preg_match('~^\.'.$role.' \{ font-family: var\((--sc-font-[a-z-]+)\);[^}]*font-weight: 600; \}$~m', $css, $rule))->toBe(1)
        ->and(preg_match('~^\s*'.preg_quote($rule[1], '~').': \'([^\']+)\'~m', $css, $stack))->toBe(1)
        ->and($stack[1])->toBe($family);
})->with([
    ['t-display-title', 'Archivo SemiExpanded'],
    ['t-title-1', 'Inter Display'],
    ['t-title-2', 'Inter Display'],
]);

it('declares every 2.0 face, swapped in on load, each url a woff2 in resources/fonts/2.0', function () {
    $css = (string) file_get_contents(resource_path('css/fonts.css'));
    preg_match_all('~@font-face \{([^}]*)\}~', $css, $faces);
    $families = [];

    expect($faces[1])->toHaveCount(20);

    foreach ($faces[1] as $face) {
        preg_match('~font-family: "([^"]+)"; font-style: normal; font-weight: (\d00);~', $face, $declared);
        preg_match('~src: url\("\.\./fonts/2\.0/([A-Za-z-]+\.woff2)"\) format\("woff2"\)~', $face, $source);

        expect($face)->toContain('font-display: swap;')
            ->and($face)->toContain('unicode-range:')
            ->and($declared)->not->toBe([])
            ->and($source)->not->toBe([])
            ->and(resource_path('fonts/2.0/'.$source[1]))->toBeFile();

        $families[$declared[1]][] = (int) $declared[2];
    }

    // Two files per face: the primary subset and Latin Extended.
    expect(array_map(fn (array $weights): array => array_values(array_unique($weights)), $families))->toBe([
        'Inter' => [400, 500, 600, 700],
        'Inter Display' => [600, 700],
        'Archivo Condensed' => [600, 700],
        'Archivo SemiExpanded' => [600, 700],
    ]);
});

it('keeps only the 2.0 files, with their licences, where the web side loads fonts from', function () {
    $css = (string) file_get_contents(resource_path('css/fonts.css'));
    $preload = (string) file_get_contents(resource_path('views/components/font-preload.blade.php'));
    $names = fn (string $pattern): array => array_map(basename(...), glob(resource_path($pattern)) ?: []);
    $faces = ['ArchivoCondensed-Bold', 'ArchivoCondensed-SemiBold', 'ArchivoSemiExpanded-Bold', 'ArchivoSemiExpanded-SemiBold', 'Inter-Bold', 'Inter-Medium', 'Inter-Regular', 'Inter-SemiBold', 'InterDisplay-Bold', 'InterDisplay-SemiBold'];

    // The packages of v1 are gone from the build: every url() and every preload points into resources/fonts/2.0.
    expect($css)->not->toContain('node_modules')
        ->and($preload)->not->toContain('node_modules')
        ->and($names('fonts/2.0/*.woff2'))->toEqualCanonicalizing([
            ...array_map(fn (string $face): string => $face.'.woff2', $faces),
            ...array_map(fn (string $face): string => $face.'-latin-ext.woff2', $faces),
        ])
        // GD and dompdf (OgImageCanvas, ShareCardCanvas, QrSticker, Placard) draw with these, and nothing else lies beside them.
        ->and($names('fonts/*.ttf'))->toEqualCanonicalizing(['ArchivoCondensed-SemiBold.ttf', 'ArchivoSemiExpanded-SemiBold.ttf', 'Inter-Medium.ttf', 'Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'InterDisplay-SemiBold.ttf'])
        ->and($names('fonts/*.txt'))->toEqualCanonicalizing(['OFL-Archivo.txt', 'OFL-Inter.txt'])
        ->and($names('fonts/2.0/*.txt'))->toEqualCanonicalizing(['OFL-Archivo.txt', 'OFL-Inter.txt']);
});
