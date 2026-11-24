<?php

use App\Enums\KeywordList;
use App\Enums\ShareCardTemplate;
use App\Models\Brand;
use App\Models\KeywordRule;
use App\Models\User;
use App\Models\VehicleSpec;
use App\Services\Qr\QrCodes;
use App\Services\Rules\KeywordNormaliser;
use App\Services\Rules\KeywordRules;
use App\Services\Signature\ShareCardCanvas;
use App\Services\Signature\ShareCardOptions;
use App\Services\Signature\ShareCards;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SignatureTestHelpers.php';

/**
 * R5-2e VEH-07 2.0 share card (12_CLIENT_ROUND_5 "share card contract"): the templates band, poster and frame on both formats, the crop
 * (zoom and centre in the template's photo box), the `mods` element, the own text line and the layout rules 1–4 (safe areas, the name
 * wraps instead of losing letters, the QR's size and quiet zone, no overlaps). The default options still give the stored card.
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    seedModSchema();
    sigFlag('sig.share_cards');
    [$this->vehicle, $this->cover] = sigVehicleWithPhoto(bytes: sigDetailedJpeg(1200, 800));
    $this->owner = $this->vehicle->owner;
    VehicleSpec::factory()->create(['vehicle_id' => $this->vehicle->id, 'power_value' => 510, 'power_unit' => 'ps', 'power_ps' => 510, 'torque_nm' => 650]);
    DB::table('build_scores')->updateOrInsert(['vehicle_id' => $this->vehicle->id], ['total' => 420, 'stage' => 3, 'formula_version' => '1', 'computed_at' => now()]);
    $this->vehicle->forceFill(['dex_number' => 87])->save();
    $this->url = "/api/v1/vehicles/{$this->vehicle->id}/share-card.png";
});

/** The PNG cropped to a rectangle, as PNG bytes. */
function tplCrop(string $png, int $x, int $y, int $width, int $height): string
{
    $image = imagecreatefromstring($png);
    $crop = $image === false ? false : imagecrop($image, ['x' => $x, 'y' => $y, 'width' => $width, 'height' => $height]);
    ob_start();
    imagepng($crop ?: imagecreatetruecolor(1, 1));

    return (string) ob_get_clean();
}

/** @param array{0: int, 1: int, 2: int, 3: int} $a */
function tplOverlap(array $a, array $b): bool
{
    return $a[0] < $b[2] && $b[0] < $a[2] && $a[1] < $b[3] && $b[1] < $a[3];
}

/**
 * The longest content a card can carry (rule 4): every element, a name of two long lines, three specs, a 30-character @username, a
 * 60-character own line and the mods line.
 *
 * @return array<string, mixed>
 */
function tplLongest(string $title = 'Skyline GT-R R34 V-Spec II Nür'): array
{
    return [
        'eyebrow' => 'MERCEDES-BENZ',
        'dex' => 'Dex Nr. 0087',
        'title' => $title,
        'specs' => '1.150 PS · 1.400 Nm · 2026',
        'handle' => '@'.str_repeat('w', 30),
        'text' => 'WWWWWWWWWW Wochenende am Nürburgring mit der ganzen Crew. Ö',
        'mods' => ['label' => '128 Mods', 'items' => ['Rays Volk Racing TE37 Saga', 'HKS GT-SS Twin Turbo', 'KW V3']],
        'qr' => true,
        'score' => true,
        'score_labels' => ['Stufe 5', 'Build Score'],
    ];
}

function tplCards(): ShareCards
{
    return app(ShareCards::class);
}

/**
 * The cap height of a drawn line, in pixels.
 *
 * @param  array{font: string, size: int}  $line
 */
function tplCap(array $line): int
{
    $box = imagettfbbox($line['size'], 0, resource_path('fonts/'.$line['font']), 'H');

    return $box === false ? 0 : -$box[7];
}

/** Every template × format. */
function tplCells(): array
{
    $cells = [];

    foreach (['band', 'poster', 'frame'] as $template) {
        foreach (['square', 'story'] as $format) {
            $cells["$template $format"] = [$template, $format];
        }
    }

    return $cells;
}

describe('photo boxes', function () {
    it('are the contract\'s table', function () {
        expect(ShareCardCanvas::photoBoxes())->toBe([
            'band' => ['square' => [1080, 600], 'story' => [1080, 1920]],
            'poster' => ['square' => [1080, 1080], 'story' => [1080, 1920]],
            'frame' => ['square' => [984, 600], 'story' => [984, 1080]],
        ])->and(array_keys(ShareCardCanvas::photoBoxes()))->toBe(array_column(ShareCardTemplate::cases(), 'value'));
    });

    it('crops the largest window of the box aspect at zoom 1, a smaller one when zoomed, and clamps it inside the photo', function () {
        // 1200 × 800 into the square band's 1080 × 600: the full width, the height of the aspect.
        expect(ShareCardCanvas::cropWindow(1200, 800, 1080, 600))->toBe([0, 67, 1200, 667])
            // Into the story: the full height, centred.
            ->and(ShareCardCanvas::cropWindow(1200, 800, 1080, 1920))->toBe([375, 0, 450, 800])
            // Zoom 2 halves the window; a centre at the edge is clamped, never letterboxed.
            ->and(ShareCardCanvas::cropWindow(1200, 800, 1080, 1080, 2.0, 0.0, 1.0))->toBe([0, 400, 400, 400])
            ->and(ShareCardCanvas::cropWindow(1200, 800, 1080, 1080, 3.0, 1.0, 0.5))->toBe([933, 267, 267, 267])
            // Out of range zoom is held at 1 to 3.
            ->and(ShareCardCanvas::cropWindow(1200, 800, 984, 600, 9.0))->toBe(ShareCardCanvas::cropWindow(1200, 800, 984, 600, 3.0));
    });
});

describe('templates', function () {
    it('draws every template and format at its exact size, and the code reads back as the page address', function (string $template, string $format) {
        foreach (['dark', 'light'] as $theme) {
            if ($theme === 'light' && $template !== 'frame') {
                continue;
            }

            $png = (string) $this->get($this->url."?format=$format&template=$template&theme=$theme")->assertOk()->assertHeader('Content-Type', 'image/png')->getContent();
            $size = getimagesizefromstring($png);
            [$x, $y, $side] = ShareCardCanvas::qrPanel($format, $template);

            expect([$size[0], $size[1]])->toBe(ShareCardCanvas::FORMATS[$format])
                ->and($side)->toBeGreaterThanOrEqual(ShareCardCanvas::QR_MIN[$format])
                ->and(readQrText(tplCrop($png, $x - 8, $y - 8, $side + 16, $side + 16)))->toBe(app(QrCodes::class)->pageUrl($this->vehicle));
        }
    })->with(tplCells());

    it('draws nothing but the photo and the scrim in the story\'s top and bottom 250 px', function (string $template) {
        $full = (string) $this->get($this->url.'?template='.$template.'&show=score,dex,specs,mods,username,qr&text='.urlencode('Samstag am Hafen'))->assertOk()->getContent();
        $bare = (string) $this->get($this->url.'?template='.$template.'&show=')->assertOk()->getContent();

        expect(sigDifference($full, $bare, 0, 0, 1080, ShareCardCanvas::STORY_SAFE))->toBe(0.0)
            ->and(sigDifference($full, $bare, 0, 1920 - ShareCardCanvas::STORY_SAFE, 1080, ShareCardCanvas::STORY_SAFE))->toBe(0.0)
            ->and(sigDifference($full, $bare, 0, ShareCardCanvas::STORY_SAFE, 1080, 1920 - 2 * ShareCardCanvas::STORY_SAFE))->toBeGreaterThan(0.5);
    })->with(['band', 'poster', 'frame']);

    it('keeps every element in the safe area and apart from every other, at every combination of elements with the longest strings', function (string $template, string $format) {
        $canvas = app(ShareCardCanvas::class);
        $longest = tplLongest();
        [$width, $height] = ShareCardCanvas::FORMATS[$format];
        $elements = ['score', 'dex', 'specs', 'mods', 'username', 'qr', 'text'];

        for ($mask = 0; $mask < 2 ** count($elements); $mask++) {
            $on = fn (string $element): bool => ($mask & (1 << array_search($element, $elements, true))) !== 0;
            $content = [
                ...$longest,
                'dex' => $on('dex') ? $longest['dex'] : null,
                'specs' => $on('specs') ? $longest['specs'] : '',
                'mods' => $on('mods') ? $longest['mods'] : null,
                'handle' => $on('username') ? $longest['handle'] : null,
                'text' => $on('text') ? $longest['text'] : null,
                'qr' => $on('qr'),
                'score' => $on('score'),
            ];
            $layout = $canvas->layout($format, $template, $content);
            $boxes = $layout['boxes'];

            foreach ($boxes as $key => $box) {
                if ($format === 'square') {
                    expect($box[0] >= ShareCardCanvas::SQUARE_SAFE && $box[1] >= ShareCardCanvas::SQUARE_SAFE && $box[2] <= $width - ShareCardCanvas::SQUARE_SAFE && $box[3] <= $height - ShareCardCanvas::SQUARE_SAFE)
                        ->toBeTrue("$template $format mask $mask: $key ".json_encode($box).' leaves the safe area');
                } else {
                    expect($box[1] >= ShareCardCanvas::STORY_SAFE && $box[3] <= $height - ShareCardCanvas::STORY_SAFE && $box[0] >= 0 && $box[2] <= $width)
                        ->toBeTrue("$template $format mask $mask: $key ".json_encode($box).' lies in the story bars');
                }

                foreach ($boxes as $other => $otherBox) {
                    if ($other !== $key) {
                        expect(tplOverlap($box, $otherBox))->toBeFalse("$template $format mask $mask: $key overlaps $other");
                    }
                }
            }

            // The name never loses a letter in any combination.
            expect(implode(' ', $layout['title']))->toBe($longest['title']);

            // Rule 6, the legibility floor in pixels of the em on the 1080 canvas: 26 for every line, 44 for the name, 22 for the
            // gauge's captions (and its total at least a line's).
            foreach ($layout['lines'] as $line) {
                $px = $line['size'] * ShareCardCanvas::PX_PER_POINT;
                $floor = $line['key'] === 'title' ? 44 : 26;
                expect($px)->toBeGreaterThanOrEqual($floor, "$template $format mask $mask: {$line['key']} '{$line['text']}' at {$px} px");
            }

            // R5DQ-05: the specs are the hero data; no line but the name is drawn taller (cap height) than they are.
            $specs = collect($layout['lines'])->firstWhere('key', 'specs');

            if ($specs !== null) {
                foreach ($layout['lines'] as $line) {
                    if ($line['key'] !== 'title' && $line['key'] !== 'specs') {
                        expect(tplCap($specs))->toBeGreaterThanOrEqual(tplCap($line), "$template $format mask $mask: {$line['key']} '{$line['text']}' is taller than the specs");
                    }
                }
            }

            // R5DQ-20: the mods line is never smaller than the @username or the own text (one font, so the sizes compare).
            $mods = collect($layout['lines'])->firstWhere('key', 'mods');

            if ($mods !== null) {
                foreach ($layout['lines'] as $line) {
                    if (in_array($line['key'], ['handle', 'text'], true)) {
                        expect($mods['size'])->toBeGreaterThanOrEqual($line['size'], "$template $format mask $mask: mods {$mods['size']} pt under {$line['key']} {$line['size']} pt");
                    }
                }
            }

            if ($on('score')) {
                [$total, $stage, $label] = $layout['gauge'] ?? [0, 0, 0];
                expect($total * ShareCardCanvas::PX_PER_POINT)->toBeGreaterThanOrEqual(26)
                    ->and($stage * ShareCardCanvas::PX_PER_POINT)->toBeGreaterThanOrEqual(22)
                    ->and($label * ShareCardCanvas::PX_PER_POINT)->toBeGreaterThanOrEqual(22);
            }

            if ($on('qr')) {
                expect($boxes['qr'][2] - $boxes['qr'][0])->toBeGreaterThanOrEqual(ShareCardCanvas::QR_MIN[$format]);
            }

            if ($on('text')) {
                expect(implode(' ', array_column(array_filter($layout['lines'], fn (array $line): bool => $line['key'] === 'text'), 'text')))->toBe($longest['text']);
            }
        }
    })->with(tplCells());

    it('wraps a long name at a word boundary instead of ending it in "…"', function (string $template, string $format, string $title) {
        $layout = app(ShareCardCanvas::class)->layout($format, $template, tplLongest($title));

        // One line where it fits at a size down to the minimum, else two broken at a space; never a lost letter.
        expect(count($layout['title']))->toBeLessThanOrEqual(2)
            ->and(implode(' ', $layout['title']))->toBe($title)
            ->and(implode('', $layout['title']))->not->toContain('…');
    })->with(function () {
        $rows = [];

        foreach (tplCells() as $name => [$template, $format]) {
            foreach (['Corolla Levin/Trueno AE86', 'Skyline GT-R R34 V-Spec II Nür'] as $title) {
                $rows["$name, $title"] = [$template, $format, $title];
            }
        }

        return $rows;
    });

    it('keeps the square band\'s gauge on the photo\'s lower right corner and lets the text column run up to the QR', function () {
        $layout = app(ShareCardCanvas::class)->layout('square', 'band', tplLongest());
        [, , , $photoBottom] = $layout['photo'];

        expect($layout['boxes']['gauge'][3])->toBeLessThanOrEqual($photoBottom)
            ->and($layout['boxes']['gauge'][2])->toBeLessThanOrEqual(1080 - ShareCardCanvas::SQUARE_SAFE)
            ->and(max(array_map(fn (array $line): int => $line['x'], $layout['lines'])))->toBeLessThan($layout['boxes']['qr'][0]);
    });

    it('fixes the square card of the AE86: "Corolla Levin/Trueno" keeps all its letters', function () {
        $layout = app(ShareCardCanvas::class)->layout('square', 'band', [...tplLongest(), 'eyebrow' => 'TOYOTA', 'title' => 'Corolla Levin/Trueno AE86', 'text' => null, 'mods' => null]);

        // With the column running up to the QR (rule 6) it now fits on one line; never "Corolla Levin/Tr…".
        expect(implode(' ', $layout['title']))->toBe('Corolla Levin/Trueno AE86')
            ->and(implode('', $layout['title']))->not->toContain('…');
    });

    it('ends in "…" only when not even two lines at the smallest size hold the name', function () {
        $title = implode(' ', array_fill(0, 12, 'Langstreckenwagen'));
        $layout = app(ShareCardCanvas::class)->layout('square', 'band', [...tplLongest(), 'title' => $title]);

        expect($layout['title'])->toHaveCount(2)
            ->and(end($layout['title']))->toEndWith('…')
            ->and($layout['title'][0])->toStartWith('Langstreckenwagen');
    });

    it('shows the same mods on every template and format (R5DQ-13)', function () {
        $canvas = app(ShareCardCanvas::class);
        $mods = ['label' => '12 Mods', 'items' => ['Rays Volk Racing TE37 Saga', 'Nismo Aero-Seitenschweller', 'KW V3', 'HKS EVC 7']];
        $lines = [];

        foreach (tplCells() as [$template, $format]) {
            $lines[] = collect($canvas->layout($format, $template, [...tplLongest(), 'mods' => $mods])['lines'])->firstWhere('key', 'mods')['text'];
        }

        expect(array_unique($lines))->toHaveCount(1)
            ->and($lines[0])->toBe($canvas->modsLine('12 Mods', $mods['items']));
    });

    it('chooses the mods at the line\'s display size: fewer parts, then the count alone, in the build\'s order (R5DQ-20)', function () {
        $canvas = app(ShareCardCanvas::class);

        // Short names fit every column at its display size; a long first name leaves the count alone rather than skipping ahead.
        expect($canvas->modsLine('12 Mods', ['KW V3', 'HKS EVC 7']))->toBe('12 Mods · KW V3 · HKS EVC 7')
            ->and($canvas->modsLine('12 Mods', ['KW V3', 'Seibon Carbon-Kofferraumdeckel OEM-Style']))->toBe('12 Mods · KW V3')
            ->and($canvas->modsLine('12 Mods', ['Rays Volk Racing TE37 Saga', 'KW V3']))->toBe('12 Mods')
            ->and($canvas->modsLine('1 Mod', []))->toBe('1 Mod');

        // Every chosen line fits every card's column at that card's display size.
        foreach (ShareCardCanvas::modsColumns() as [$width, $size]) {
            $box = imagettfbbox($size, 0, resource_path('fonts/Inter-Medium.ttf'), '12 Mods · KW V3 · HKS EVC 7');
            expect(abs($box[2] - $box[0]))->toBeLessThanOrEqual($width);
        }
    });

    it('names whole mods only, at most two, after the count', function () {
        $narrow = app(ShareCardCanvas::class)->layout('square', 'poster', [...tplLongest(), 'mods' => ['label' => '12 Mods', 'items' => ['Rays Volk Racing TE37 Saga', 'KW V3', 'HKS EVC 7', 'Bride Zeta III']]]);
        $line = collect($narrow['lines'])->firstWhere('key', 'mods')['text'];
        $parts = explode(' · ', $line);

        expect($parts[0])->toBe('12 Mods')
            ->and(count($parts))->toBeLessThanOrEqual(3)
            ->and(array_diff(array_slice($parts, 1), ['Rays Volk Racing TE37 Saga', 'KW V3', 'HKS EVC 7', 'Bride Zeta III']))->toBe([])
            ->and($line)->not->toContain('…');
    });
});

describe('options', function () {
    it('shows the mods line only on request: the count and the build\'s installed mods by brand and short name', function () {
        $brand = Brand::factory()->create(['name' => 'KW']);
        modIn($this->vehicle, 'suspension', [], ['title' => 'KW V3', 'brand_id' => $brand->id, 'part_name' => 'V3', 'status' => 'installed', 'sort' => 1]);
        modIn($this->vehicle, 'suspension', [], ['title' => 'Geplant', 'status' => 'planned', 'sort' => 2]);
        $vehicle = $this->vehicle->fresh(ShareCards::RELATIONS);
        $spec = (new ReflectionMethod(ShareCards::class, 'spec'))->invoke(app(ShareCards::class), $vehicle, $this->cover, 'square', new ShareCardOptions(show: ['mods']));

        expect($spec['mods'])->toBe(['label' => '1 Mod', 'items' => ['KW V3']])
            ->and(tplCards()->path($vehicle, 'square', new ShareCardOptions(show: [...ShareCardOptions::DEFAULT_SHOW, 'mods'])))->not->toBe(tplCards()->path($vehicle, 'square'))
            ->and(ShareCardOptions::defaults()->shows('mods'))->toBeFalse();

        $this->get($this->url.'?format=square&show=mods,specs')->assertOk();
    });

    it('names a card after the template, the crop and the text; the defaults written out give the stored card', function () {
        $vehicle = $this->vehicle->fresh(ShareCards::RELATIONS);
        $default = tplCards()->path($vehicle, 'square');
        $paths = [
            tplCards()->path($vehicle, 'square', new ShareCardOptions(template: 'poster')),
            tplCards()->path($vehicle, 'square', new ShareCardOptions(template: 'frame')),
            tplCards()->path($vehicle, 'square', new ShareCardOptions(zoom: 1.5)),
            tplCards()->path($vehicle, 'square', new ShareCardOptions(x: 0.1)),
            tplCards()->path($vehicle, 'square', new ShareCardOptions(y: 0.9)),
            tplCards()->path($vehicle, 'square', new ShareCardOptions(text: 'Samstag am Hafen')),
        ];

        expect(array_unique([$default, ...$paths]))->toHaveCount(7)
            ->and(tplCards()->path($vehicle, 'square', new ShareCardOptions(template: 'band', zoom: 1.0, x: 0.5, y: 0.5)))->toBe($default)
            // The poster is always dark, the story band too: the theme does not name them.
            ->and(tplCards()->path($vehicle, 'story', new ShareCardOptions(template: 'poster', theme: 'light')))->toBe(tplCards()->path($vehicle, 'story', new ShareCardOptions(template: 'poster')))
            ->and(tplCards()->path($vehicle, 'story', new ShareCardOptions(template: 'frame', theme: 'light')))->not->toBe(tplCards()->path($vehicle, 'story', new ShareCardOptions(template: 'frame')));
    });

    it('keeps the stored card for the defaults written out, and never gives a customised card a public URL', function () {
        $this->get($this->url.'?format=square&template=band&theme=dark&zoom=1&x=0.5&y=0.5&show=score,dex,specs,username,qr')->assertOk();
        $public = Storage::disk('public')->allFiles('share/'.strtolower($this->vehicle->id));

        expect($public)->toHaveCount(1)
            ->and($public[0])->toBe(tplCards()->path($this->vehicle->fresh(ShareCards::RELATIONS), 'square'))
            ->and(Storage::disk('local')->allFiles('share-cards'))->toBe([]);

        $this->get($this->url.'?format=square&template=poster&zoom=1.5&x=0.2&text='.urlencode('Samstag am Hafen'))->assertOk();

        expect(Storage::disk('public')->allFiles('share/'.strtolower($this->vehicle->id)))->toBe($public)
            ->and(Storage::disk('local')->allFiles('share-cards/'.strtolower($this->vehicle->id)))->toHaveCount(1);

        $urls = $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertOk()->json('data.share_card_url');
        expect($urls['square'])->toEndWith(basename($public[0]));
    });

    it('moves the crop with the centre and the zoom', function () {
        $centre = (string) $this->get($this->url.'?format=square&template=poster&show=')->getContent();
        $left = (string) $this->get($this->url.'?format=square&template=poster&show=&x=0')->getContent();
        $zoomed = (string) $this->get($this->url.'?format=square&template=poster&show=&zoom=2.5')->getContent();

        expect(sigDifference($centre, $left, 0, 400, 1080, 200))->toBeGreaterThan(1.0)
            ->and(sigDifference($centre, $zoomed, 0, 400, 1080, 200))->toBeGreaterThan(1.0);
    });

    it('takes a 60-character own line with umlauts and German quotes', function () {
        $text = '„Hachiroku“ – Samstag am Hafen, danach Kaffee bei Jörg… Ü·ß';
        expect(mb_strlen($text))->toBeLessThanOrEqual(60);

        $this->get($this->url.'?format=square&text='.urlencode($text))->assertOk();
        $this->get($this->url.'?format=square&text='.urlencode('  '.str_repeat('a', 60).'  '))->assertOk();
    });

    it('validates the template, the crop and the own line', function (string $query, string $field, ?string $message) {
        $response = $this->getJson($this->url.'?'.$query)->assertUnprocessable()->assertJsonValidationErrors($field)->assertJsonPath('code', 'validation_failed');

        if ($message !== null) {
            $response->assertJsonPath("errors.$field.0", __($message, ['max' => 60]));
        }
    })->with([
        'unknown template' => ['template=collage', 'template', null],
        'zoom under 1' => ['zoom=0.5', 'zoom', null],
        'zoom over 3' => ['zoom=3.5', 'zoom', null],
        'zoom with three decimals' => ['zoom=1.255', 'zoom', null],
        'zoom not a number' => ['zoom=gross', 'zoom', null],
        'x under 0' => ['x=-0.1', 'x', null],
        'x over 1' => ['x=1.1', 'x', null],
        'y over 1' => ['y=2', 'y', null],
        'emoji' => ['text='.urlencode('Samstag 🏁'), 'text', 'signature.share_card.text_characters'],
        'line break' => ['text='.urlencode("Samstag\nam Hafen"), 'text', 'signature.share_card.text_characters'],
        'control character' => ['text='.urlencode("Samstag\x07"), 'text', 'signature.share_card.text_characters'],
        'Cyrillic' => ['text='.urlencode('Привет'), 'text', 'signature.share_card.text_characters'],
        'too long' => ['text='.str_repeat('a', 61), 'text', 'signature.share_card.text_length'],
        'an array' => ['text[]=a', 'text', 'signature.share_card.text_characters'],
        'unknown element' => ['show=mods,laptime', 'show.1', null],
    ]);

    it('says the characters rule in German and in English', function () {
        expect(__('signature.share_card.text_characters', [], 'de'))->toBe('Nur Buchstaben, Ziffern und Satzzeichen, keine Emojis.')
            ->and(__('signature.share_card.text_characters', [], 'en'))->toBe('Only letters, digits and punctuation, no emojis.');
    });

    it('refuses an own line with a term of the block list with the rules\' neutral message, without naming it, and counts the hit', function () {
        $rule = new KeywordRule;
        $rule->forceFill(['term' => 'schrottkarre', 'normalized' => KeywordNormaliser::term('schrottkarre'), 'list' => KeywordList::Block])->save();
        app(KeywordRules::class)->flush();

        $response = $this->getJson($this->url.'?text='.urlencode('Keine Schrottkarre'))->assertUnprocessable()
            ->assertJsonPath('code', 'content_blocked')
            ->assertJsonPath('errors.text.0', __('errors.content_blocked_field'));

        expect((string) $response->getContent())->not->toContain('chrottkarre')
            ->and(DB::table('keyword_rule_hits')->where(['keyword_rule_id' => $rule->id, 'field' => 'share_card_text'])->value('hits'))->toBe(1);
        $this->get($this->url.'?text='.urlencode('Kein Problem'))->assertOk();
    });
});

describe('access', function () {
    it('keeps the answers for a private build, a guest and a build without a photo', function () {
        $this->vehicle->forceFill(['visibility' => 'private'])->save();

        $this->getJson($this->url.'?template=frame&text=Hallo')->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');

        Sanctum::actingAs(User::factory()->create());
        $this->getJson($this->url.'?template=poster')->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');

        Sanctum::actingAs($this->owner);
        $png = (string) $this->get($this->url.'?format=square&template=frame&theme=light&text=Hallo')->assertOk()->assertHeader('Cache-Control', 'no-store, private')->getContent();
        expect(getimagesizefromstring($png)[1])->toBe(1080)
            ->and(Storage::disk('local')->allFiles('share-cards'))->toBe([])
            ->and(Storage::disk('public')->allFiles('share'))->toBe([]);

        $this->vehicle->forceFill(['visibility' => 'public'])->save();
        $this->vehicle->media()->delete();
        $this->vehicle->forceFill(['cover_media_id' => null])->save();
        $this->getJson($this->url.'?template=poster')->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
    });
});
