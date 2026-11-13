<?php

use App\Models\User;
use App\Services\PublicPages\OgImageCanvas;
use App\Services\PublicPages\OgImages;
use FontLib\Font;
use Illuminate\Support\Facades\Storage;
use Tests\Support\TestImages;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * BH-24: the share card never draws garbage. GD has no fallback font, no shaping and reads a four-byte character byte by byte, so what the
 * fonts lack is left out before anything is measured or drawn.
 */
/**
 * The first row from the top with bright text, below the wordmark: where a card's text starts.
 */
function ogTextTop(string $jpeg): int
{
    $image = imagecreatefromstring($jpeg);

    for ($y = 200; $y < imagesy($image); $y++) {
        for ($x = 64; $x < 1100; $x += 3) {
            if ((imagecolorat($image, $x, $y) >> 8 & 0xFF) > 230 && (imagecolorat($image, $x, $y) & 0xFF) > 230) {
                return $y;
            }
        }
    }

    return -1;
}

beforeEach(function () {
    Storage::fake('public');
    $this->canvas = app(OgImageCanvas::class);
    $this->photo = TestImages::jpeg(1200, 630);
    $this->member = fn (string $name, ?string $city = null): string => $this->canvas->member(null, null, null, null, $name, '@nina', $city);
    $this->vehicle = fn (?string $eyebrow, string $title, string $specs = ''): string => $this->canvas->vehicle($this->photo, null, null, $eyebrow, $title, $specs === '' ? [] : [['value' => $specs, 'unit' => null, 'label' => 'Leistung']]);
});

describe('sanitise', function () {
    it('leaves out what no font can draw and tidies up after it', function (string $text, string $expected) {
        expect($this->canvas->sanitise($text))->toBe($expected);
    })->with([
        'emoji only, with VS16' => ["🏎\u{FE0F}", ''],
        'a family of emoji with ZWJ' => ["👨\u{200D}👩\u{200D}👧", ''],
        'emoji and name' => ["Nina 🏎\u{FE0F}", 'Nina'],
        'emoji inside a name' => ['Nina 🏎 Neu', 'Nina Neu'],
        'a keycap' => ["1\u{FE0F}\u{20E3} Nina", '1 Nina'],
        'above the BMP, not an emoji' => ['𝓝ina', 'ina'],
        'Arabic' => ['محمد', ''],
        'Hebrew' => ['שלום', ''],
        'Japanese' => ['スカイライン', ''],
        'Chinese' => ['日産', ''],
        'Arabic beside Latin' => ['محمد Ali', 'Ali'],
        'Cyrillic stays' => ['Иван', 'Иван'],
        'Greek stays' => ['Νίκος', 'Νίκος'],
        'Turkish and Polish stay' => ['Ayşe Yılmaz Łukasz', 'Ayşe Yılmaz Łukasz'],
        'German stays' => ['Jürgen Weiß', 'Jürgen Weiß'],
        'the capital sharp s stays' => ['STRAẞE GROẞ', 'STRAẞE GROẞ'],
        'a decomposed umlaut joins up' => ["Ju\u{0308}rgen", 'Jürgen'],
        'a right-to-left mark' => ["Nina\u{200F}", 'Nina'],
        'a control character' => ["Ni\u{0007}na", 'Nina'],
        'bytes that are no text become something drawable' => ["Ni\xFFna", 'Ni?na'],
        'spaces of all kinds' => ["  Nina \u{00A0} Neu  ", 'Nina Neu'],
        'a thin space keeps the words apart' => ["Nina\u{2009}Neu", 'Nina Neu'],
        'typography stays' => ['„Nina“ – 5 € …', '„Nina“ – 5 € …'],
        'empty' => ['', ''],
        'brackets around what no font has' => ['(محمد)', ''],
        'a separator between emoji' => ["🏎\u{FE0F} - 🏁", ''],
        'a city of flags' => ['🇩🇪 · 🇯🇵', ''],
        'a make in brackets' => ['(日産)', ''],
        'an empty pair after a name' => ['Ali ()', 'Ali'],
        'an empty pair inside a name' => ['Ali (محمد) Khan', 'Ali Khan'],
        'nested empty pairs' => ['Ali ([日産])', 'Ali'],
        'separators that met' => ['Ali 🏎 - 🏁 - Khan', 'Ali - Khan'],
        'a separator left at an edge' => ['🏁 · Nina ·', 'Nina'],
        'a hyphen inside a word stays' => ['Skyline GT-R', 'Skyline GT-R'],
        'brackets with something in them stay' => ['Nina (Neu)', 'Nina (Neu)'],
        'punctuation alone is nothing' => ['- · ()', ''],
    ]);

    it('says true of its lists: every range is really in the font', function () {
        $font = fn (string $file): array => tap(Font::load(resource_path('fonts/'.$file)), fn ($parsed) => $parsed->parse())->getUnicodeCharMap();
        // Every Inter cut a card draws with, Inter Display for a member's name among them: none of them may lack a letter of the list.
        $inters = ['Inter-Medium.ttf' => $font('Inter-Medium.ttf'), 'InterDisplay-SemiBold.ttf' => $font('InterDisplay-SemiBold.ttf')];
        $archivos = ['ArchivoSemiExpanded-SemiBold.ttf' => $font('ArchivoSemiExpanded-SemiBold.ttf'), 'ArchivoCondensed-SemiBold.ttf' => $font('ArchivoCondensed-SemiBold.ttf')];
        $missing = [];

        foreach (OgImageCanvas::INTER_RANGES as [$from, $to]) {
            foreach (range($from, $to) as $codePoint) {
                foreach ($inters as $file => $map) {
                    if (($map[$codePoint] ?? 0) === 0) {
                        $missing[] = $file.' U+'.dechex($codePoint);
                    }
                }
            }
        }

        foreach (OgImageCanvas::ARCHIVO_RANGES as [$from, $to]) {
            foreach (range($from, $to) as $codePoint) {
                foreach ($archivos as $file => $map) {
                    if (($map[$codePoint] ?? 0) === 0) {
                        $missing[] = $file.' U+'.dechex($codePoint);
                    }
                }
            }
        }

        expect($missing)->toBe([]);
    });

    it('lists Archivo only within what Inter has, Cyrillic outside', function () {
        foreach (OgImageCanvas::ARCHIVO_RANGES as [$from, $to]) {
            foreach (range($from, $to) as $codePoint) {
                // Spaces go at the edges, and they are in Inter's list as well: x x keeps it.
                expect($this->canvas->sanitise('x'.mb_chr($codePoint).'x'))->not->toBe('xx', 'U+'.dechex($codePoint));
            }
        }

        $archivo = fn (int $codePoint): bool => collect(OgImageCanvas::ARCHIVO_RANGES)->contains(fn (array $range): bool => $codePoint >= $range[0] && $codePoint <= $range[1]);

        expect($archivo(mb_ord('И')))->toBeFalse()
            ->and($archivo(mb_ord('Ξ')))->toBeFalse()
            ->and($archivo(mb_ord('ẞ')))->toBeTrue()
            ->and($archivo(mb_ord('Ş')))->toBeTrue();
    });

    it('chooses Archivo for a car, Inter when Archivo lacks a letter, Inter Display for a person', function (string $font, string $text, string $expected) {
        $fontFor = new ReflectionMethod(OgImageCanvas::class, 'fontFor');

        expect($fontFor->invoke($this->canvas, $font, $text))->toBe($expected);
    })->with([
        'a model' => ['ArchivoSemiExpanded-SemiBold.ttf', 'Skyline GT-R', 'ArchivoSemiExpanded-SemiBold.ttf'],
        'the capital sharp s, which Archivo has' => ['ArchivoSemiExpanded-SemiBold.ttf', 'GROẞ', 'ArchivoSemiExpanded-SemiBold.ttf'],
        'a make in Cyrillic' => ['ArchivoSemiExpanded-SemiBold.ttf', 'Лада', 'Inter-Medium.ttf'],
        'one letter Archivo lacks moves the whole line' => ['ArchivoSemiExpanded-SemiBold.ttf', 'Skyline ƀ', 'Inter-Medium.ttf'],
        'spec numerals' => ['ArchivoCondensed-SemiBold.ttf', '280 PS · 3,9 s', 'ArchivoCondensed-SemiBold.ttf'],
        'a member in Greek' => ['InterDisplay-SemiBold.ttf', 'Νίκος', 'InterDisplay-SemiBold.ttf'],
    ]);
});

describe('the drawn card', function () {
    it('draws a name with an emoji exactly as the name alone', function () {
        expect(($this->member)("Nina 🏎\u{FE0F}"))->toBe(($this->member)('Nina'));
    });

    it('draws Cyrillic in real letters, not in identical boxes', function () {
        $first = ($this->member)('И');
        $second = ($this->member)('Д');

        expect($first)->not->toBe($second);
    });

    it('draws Greek in real letters, not in identical boxes', function () {
        expect(($this->member)('Ξ'))->not->toBe(($this->member)('Φ'));
    });

    it('draws a capital sharp s as a real Archivo letter, not the box Archivo draws for a code point it lacks', function () {
        $archivo = resource_path('fonts/ArchivoSemiExpanded-SemiBold.ttf');
        $map = tap(Font::load($archivo), fn ($parsed) => $parsed->parse())->getUnicodeCharMap();
        // GD forced into Archivo, as the card's title line is: a code point the font lacks comes out as its .notdef glyph.
        $draw = function (string $text) use ($archivo): string {
            $image = imagecreatetruecolor(160, 120);
            imagefill($image, 0, 0, (int) imagecolorallocate($image, 0, 0, 0));
            imagettftext($image, 64, 0, 24, 96, (int) imagecolorallocate($image, 255, 255, 255), $archivo, $text);
            ob_start();
            imagepng($image);

            return (string) ob_get_clean();
        };

        // Archivo has U+1E9E, and lacks U+0180 (ƀ) and U+0416 (Ж): those two draw the same box.
        expect($map[0x1E9E] ?? 0)->not->toBe(0)
            ->and($map[0x0180] ?? 0)->toBe(0)
            ->and($map[0x0416] ?? 0)->toBe(0)
            ->and($draw('ƀ'))->toBe($draw('Ж'))
            ->and($draw('ẞ'))->not->toBe($draw('ƀ'))
            // And the card does not leave it out of a title.
            ->and(($this->vehicle)(null, 'GROẞ'))->not->toBe(($this->vehicle)(null, 'GRO'));
    });

    it('draws a city in Arabic as no city, leaving only the handle', function () {
        expect(($this->member)('Nina', 'الرياض'))->toBe(($this->member)('Nina'));
    });

    it('draws an empty eyebrow and title on a vehicle as nothing at all', function () {
        expect(($this->vehicle)('日産', "スカイライン 🏎\u{FE0F}"))->toBe(($this->vehicle)(null, ''));
    });

    it('draws a title with nothing drawable left as no title, and keeps the eyebrow and the specs where they stand', function () {
        $without = ($this->vehicle)('NISSAN', '日産', '280 PS');

        expect($without)->toBe(($this->vehicle)('NISSAN', '', '280 PS'))
            ->and($without)->not->toBe(($this->vehicle)(null, '', '280 PS'))
            // The panel is laid out from the top: the first white text below the wordmark is the title, else the spec numeral.
            ->and(ogTextTop($without))->toBeGreaterThan(ogTextTop(($this->vehicle)('NISSAN', 'Skyline', '280 PS')));
    });

    it('still draws the title when the eyebrow is gone', function () {
        expect(($this->vehicle)('日産', 'Skyline'))->toBe(($this->vehicle)(null, 'Skyline'));
    });

    it('draws a city of flags as no city, and a make in brackets as no eyebrow', function () {
        expect(($this->member)('Nina', '🇩🇪 · 🇯🇵'))->toBe(($this->member)('Nina'))
            ->and(($this->vehicle)('(日産)', 'Skyline'))->toBe(($this->vehicle)(null, 'Skyline'));
    });

    it('draws an entity as typed, never as the character GD would make of it', function (string $typed, string $other) {
        // Decoded, both would be the same glyph or the same box; typed, the digits differ.
        expect(($this->member)($typed))->not->toBe(($this->member)($other));
    })->with([
        'a Hebrew letter by number' => ['A &#1488; B', 'A &#1489; B'],
        'a named entity' => ['A &amp; B', 'A & B'],
        'an emoji by hex number' => ['A &#x1F3CE; B', 'A &#x1F3CF; B'],
    ]);

    it('measures an entity as typed, so a long one still ends in an ellipsis inside the card', function () {
        $long = str_repeat('&#1488;', 40);
        $image = imagecreatefromstring(($this->member)($long));
        $right = 0;

        // Right of the margin, where the name line would run on if it were measured decoded and drawn as typed.
        for ($x = OgImageCanvas::WIDTH - 1; $x > OgImageCanvas::WIDTH - 60; $x--) {
            for ($y = 380; $y < 600; $y += 2) {
                if ((imagecolorat($image, $x, $y) & 0xFF) > 230) {
                    $right = max($right, $x);
                }
            }
        }

        expect($right)->toBe(0);
    });

    it('keeps Latin names and titles as they were drawn', function () {
        expect(($this->member)('Ayşe Yılmaz'))->not->toBe(($this->member)('Ayse Yilmaz'))
            ->and(($this->vehicle)('NISSAN', 'Skyline GT-R', '280 PS'))->not->toBe(($this->vehicle)(null, 'Skyline GT-R', '280 PS'));
    });
});

describe('the callers choose the fallback', function () {
    function ogDrawn(User $member): string
    {
        Storage::disk('public')->assertExists($path = (string) $member->fresh()->getAttribute('og_image_path'));

        return (string) Storage::disk('public')->get($path);
    }

    it('falls back to the handle when nothing of the name can be drawn', function (string $name) {
        $member = User::factory()->create(['username' => 'nina.neu', 'display_name' => $name, 'city' => null]);

        app(OgImages::class)->draw($member->load(OgImages::MEMBER_RELATIONS));

        expect(ogDrawn($member))->toBe(app(OgImageCanvas::class)->member(null, null, null, null, 'nina.neu', '@nina.neu', null));
    })->with(['emoji only' => "🏎\u{FE0F}", 'Arabic' => 'محمد', 'Japanese' => 'スカイライン', 'Arabic in brackets' => '(محمد)', 'emoji around a dash' => "🏎\u{FE0F} - 🏁"]);

    it('draws a name that PHP would call empty, instead of the handle', function () {
        $member = User::factory()->create(['username' => 'nina.neu', 'display_name' => '0', 'city' => null]);

        app(OgImages::class)->draw($member->load(OgImages::MEMBER_RELATIONS));

        expect(ogDrawn($member))->toBe(app(OgImageCanvas::class)->member(null, null, null, null, '0', '@nina.neu', null))
            ->and(ogDrawn($member))->not->toBe(app(OgImageCanvas::class)->member(null, null, null, null, 'nina.neu', '@nina.neu', null));
    });

    it('keeps what can be drawn of a mixed name', function () {
        $member = User::factory()->create(['username' => 'nina.neu', 'display_name' => "Nina 🏎\u{FE0F}", 'city' => null]);

        app(OgImages::class)->draw($member->load(OgImages::MEMBER_RELATIONS));

        expect(ogDrawn($member))->toBe(app(OgImageCanvas::class)->member(null, null, null, null, 'Nina', '@nina.neu', null));
    });

    it('keeps a Cyrillic name instead of falling back', function () {
        $member = User::factory()->create(['username' => 'ivan', 'display_name' => 'Иван', 'city' => null]);

        app(OgImages::class)->draw($member->load(OgImages::MEMBER_RELATIONS));

        expect(ogDrawn($member))->toBe(app(OgImageCanvas::class)->member(null, null, null, null, 'Иван', '@ivan', null))
            ->and(ogDrawn($member))->not->toBe(app(OgImageCanvas::class)->member(null, null, null, null, 'ivan', '@ivan', null));
    });

    it('draws a vehicle with a free text in Japanese, and redraws what was drawn before', function () {
        $owner = User::factory()->create(['username' => 'kenji']);
        $vehicle = publishedVehicle($owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => '日産', 'model_text' => 'スカイライン']);
        $photo = $vehicle->media()->firstOrFail();

        foreach ($photo->getAttribute('variants') as $path) {
            Storage::disk('public')->put($path, TestImages::webp(1600, 1067));
        }

        expect(app(OgImages::class)->draw($vehicle->load(OgImages::VEHICLE_RELATIONS)))->not->toBe(app(OgImages::class)->defaultUrl())
            ->and((new ReflectionClassConstant(OgImages::class, 'VERSION'))->getValue())->toBeGreaterThanOrEqual(2);
    });
});
