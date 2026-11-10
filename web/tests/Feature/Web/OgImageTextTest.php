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
    $this->vehicle = fn (?string $eyebrow, string $title, string $specs = ''): string => $this->canvas->vehicle($this->photo, null, null, $eyebrow, $title, $specs);
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
        $inter = $font('Inter-Medium.ttf');
        $barlowBold = $font('BarlowSemiCondensed-Bold.ttf');
        $barlowSemiBold = $font('BarlowSemiCondensed-SemiBold.ttf');
        $missing = [];

        foreach (OgImageCanvas::INTER_RANGES as [$from, $to]) {
            foreach (range($from, $to) as $codePoint) {
                if (($inter[$codePoint] ?? 0) === 0) {
                    $missing[] = 'Inter U+'.dechex($codePoint);
                }
            }
        }

        foreach (OgImageCanvas::BARLOW_RANGES as [$from, $to]) {
            foreach (range($from, $to) as $codePoint) {
                if (($barlowBold[$codePoint] ?? 0) === 0 || ($barlowSemiBold[$codePoint] ?? 0) === 0) {
                    $missing[] = 'Barlow U+'.dechex($codePoint);
                }
            }
        }

        expect($missing)->toBe([]);
    });

    it('counts on Inter for every letter Barlow has', function () {
        foreach (OgImageCanvas::BARLOW_RANGES as [$from, $to]) {
            foreach (range($from, $to) as $codePoint) {
                // Spaces go at the edges, and they are in Inter's list as well: x x keeps it.
                expect($this->canvas->sanitise('x'.mb_chr($codePoint).'x'))->not->toBe('xx', 'U+'.dechex($codePoint));
            }
        }
    });
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

    it('draws a capital sharp s in Inter, as Barlow has none', function () {
        // Barlow lacks both: on a line in Barlow they would be the same box.
        expect(($this->vehicle)(null, 'ẞ'))->not->toBe(($this->vehicle)(null, 'ƀ'))
            ->and(($this->vehicle)(null, 'GROẞ'))->not->toBe(($this->vehicle)(null, 'GRO'));
    });

    it('draws a city in Arabic as no city, leaving only the handle', function () {
        expect(($this->member)('Nina', 'الرياض'))->toBe(($this->member)('Nina'));
    });

    it('draws an empty eyebrow and title on a vehicle as nothing at all', function () {
        expect(($this->vehicle)('日産', "スカイライン 🏎\u{FE0F}"))->toBe(($this->vehicle)(null, ''));
    });

    it('leaves no gap where the title was: the eyebrow moves down to the line above the specs', function () {
        $without = ($this->vehicle)('NISSAN', '日産', '280 PS');

        expect($without)->not->toBe(($this->vehicle)(null, '', '280 PS'))
            ->and(ogTextTop($without))->toBe(ogTextTop(($this->vehicle)('NISSAN', 'Skyline', '280 PS')) + 88);
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
