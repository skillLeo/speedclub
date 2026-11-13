<?php

use App\Models\User;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\File;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * Design QA M4.1 round 3 on the public pages: the badge role of the app (DQ-923), names and identifiers in running text
 * (DQ-926, DQ-927) and the running-text wrap (DQ-934, without the shorthand of DQ-922 and the limit of DQ-925).
 */
function appSource(string $path): string
{
    return (string) file_get_contents(dirname(base_path()).'/mobile/'.$path);
}

/** The class list of the first element carrying `$testid`. */
function classesOf(string $html, string $testid): string
{
    preg_match('~<[a-z]+ class="([^"]*)"[^>]*data-testid="'.preg_quote($testid, '~').'"~', $html, $match);

    return $match[1] ?? '';
}

/** The text role class Blade uses for an app Text variant: labelBadge → text-label-badge. */
function bladeRole(string $variant): string
{
    return 'text-'.strtolower((string) preg_replace('/(?<!^)[A-Z]/', '-$0', $variant));
}

beforeEach(function () {
    seedModSchema();
    $this->owner = User::factory()->create(['username' => 'lukas.sc', 'display_name' => 'Lukas Scholz', 'city' => 'Stuttgart']);
    $this->vehicle = publishedVehicle($this->owner, ['make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'Nissan', 'model_text' => 'Skyline GT-R R34', 'model_year' => 2002]);
});

describe('the status pill and the main badge in label.badge (DQ-923, ADR-421 a, ADR-423)', function () {
    it('sets the Blade pill in the role of the app StatusPill, never hyphenated', function () {
        $source = appSource('src/ui/StatusPill.tsx');
        preg_match('~<Text[^>]*\bvariant="(\w+)"~', $source, $variant);

        expect($variant[1] ?? null)->toBe('labelBadge')
            ->and($source)->toMatch('~<Text[^>]*hyphenate=\{false\}~');

        $pill = Blade::render('<x-public.status-pill label="Teilegutachten" data-testid="pill" />');
        $classes = explode(' ', classesOf($pill, 'pill'));

        expect($classes)->toContain(bladeRole($variant[1]))
            ->toContain('hyphens-none')
            ->toContain('whitespace-nowrap')
            ->not->toContain('text-caption')
            ->and($pill)->toContain('>Teilegutachten</span>');
    });

    it('caps the badge role at 1.3 in the generated tokens, as the app caps labelBadge', function () {
        $css = (string) file_get_contents(resource_path('css/tokens.generated.css'));

        expect($css)->toContain('--sc-type-label-badge-size: calc(11px * min(var(--sc-type-scale, 1), 1.3));')
            ->toContain('--sc-type-label-badge-line: calc(14px * min(var(--sc-type-scale, 1), 1.3));')
            // The caption the pill used in round 3 is not capped: that is the defect.
            ->toContain('--sc-type-caption-size: calc(12px * var(--sc-type-scale, 1));')
            ->and((string) file_get_contents(resource_path('css/tailwind-theme.generated.css')))->toContain('--text-label-badge: var(--sc-type-label-badge-size);');
    });

    it('sets the Hauptfahrzeug badge of a vehicle card in the same role', function () {
        $html = Blade::render('<x-public.vehicle-card :card="$card" testid="card" />', ['card' => [
            'slug' => 'skyline', 'cover' => null, 'is_main' => true, 'full_title' => 'Nissan Skyline GT-R R34', 'model_year' => 2002,
            'spec_strip' => [], 'subline_parts' => ['Bayside Blue', 'RB26-DETT'],
        ]]);
        $classes = explode(' ', classesOf($html, 'card.main'));

        expect($classes)->toContain('text-label-badge')->toContain('hyphens-none')->toContain('whitespace-nowrap')->not->toContain('text-caption')
            // DQ-926: the sub-line keeps a hyphenated name whole.
            ->and($html)->toContain('Bayside Blue · <span class="sc-keep">RB26-DETT</span>');
    });

    it('keeps no other v1 badge role in caption on the public pages', function () {
        $views = collect(File::allFiles(resource_path('views/components/public')))
            ->merge(File::allFiles(resource_path('views/public')));

        foreach ($views as $file) {
            $source = (string) file_get_contents($file->getPathname());

            // A pill or badge shape (min-h-20, radius 4, padding 8) is set in label.badge, never in caption.
            expect(preg_match('~min-h-20 items-center rounded-xs[^"]*text-caption~', $source))->toBe(0, $file->getRelativePathname());
        }
    });

    it('keeps a store name whole on WEB-03, once the store links exist (09 §9 WEB-03 (5))', function () {
        config(['speedclub.mobile.store_url_ios' => 'https://apps.apple.com/app/id1', 'speedclub.mobile.store_url_android' => 'https://play.google.com/store/apps/details?id=x']);
        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/')->assertOk()->getContent();

        expect(substr_count($html, 'data-testid="WEB-03.store"'))->toBe(2)
            ->and($html)->toContain('<span class="whitespace-nowrap hyphens-none">Google Play</span>')
            ->and($html)->toContain('<span class="whitespace-nowrap hyphens-none">App Store</span>')
            ->and($html)->not->toContain('Bald verfügbar');
    });
});

describe('names and identifiers in running text (DQ-926, DQ-927)', function () {
    it('shows the handle on WEB-01 as it is, in the empty hero, the owner chip and the closing card', function () {
        $this->vehicle->media()->delete();
        $this->owner->forceFill(['display_name' => null])->save();

        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent();

        expect($html)->toContain('@<span class="sc-ident">lukas.<wbr>sc</span> hat für dieses Fahrzeug noch keine Bilder hochgeladen.')
            ->toContain('Fragen an <span class="sc-ident">@lukas.<wbr>sc</span>?')
            // DQ-1047: the owner chip of the identity block (avatar 32 + @handle, as the app's VehicleIdentity) sets the handle as one
            // word, never hyphenated (one text run for the parity test).
            ->toMatch('~data-testid="VEH-01.ownerRow">.*?<span class="min-w-0 truncate text-callout"><span class="sc-ident">@lukas.sc</span></span>~s')
            ->not->toContain("\u{00AD}");
    });

    it('keeps an in-word hyphen of a person\'s name in the closing card and the owner chip', function () {
        $this->owner->forceFill(['display_name' => 'Anna-Lena Brück'])->save();

        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent();

        // The closing card joins the hyphen to the next part (word joiner), so "Anna-" never ends a line. The chip of DQ-1047 names the
        // member by the handle, with the name's initials in the avatar: no line of it can split the name.
        expect($html)->toContain("Fragen an Anna-\u{2060}Lena Brück?")
            ->toMatch('~data-testid="VEH-01.ownerRow">.*?<span aria-hidden="true" class="text-callout text-ink-2">AL</span>.*?<span class="sc-ident">@lukas.sc</span>~s')
            ->not->toContain("Anna-\u{00AD}")
            ->not->toContain('Anna-<wbr>');
    });

    it('keeps a short hyphenated word of a mod name whole, as the app\'s ModRow', function () {
        modIn($this->vehicle, 'exhaust', ['type' => 'catback'], ['title' => 'Akrapovič Slip-On Line']);

        expect((string) $this->withHeader('Accept-Language', 'de')->get('/v/'.$this->vehicle->canonicalSlug())->getContent())
            ->toContain('<p class="text-body-strong text-ink">Akrapovič <span class="sc-keep">Slip-On</span> Line</p>');
    });

    it('shows the handle on WEB-02 and in its empty garage as it is', function () {
        $member = User::factory()->create(['username' => 'nina.neu', 'display_name' => 'Nina']);

        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/u/nina.neu')->assertOk()->getContent();

        expect($html)->toContain('data-testid="WEB-02.handle"><span class="sc-ident">@nina.<wbr>neu</span></p>')
            ->toContain('Sobald @<span class="sc-ident">nina.<wbr>neu</span> ein Auto veröffentlicht, steht es hier.')
            ->and($member->username)->toBe('nina.neu');
    });

    it('shows the handle of the featured build on WEB-03 as it is', function () {
        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/')->assertOk()->getContent();

        expect($html)->toContain('<span class="sc-ident">@lukas.<wbr>sc</span> · Stuttgart');
    });

    it('never hyphenates the example address on WEB-09', function () {
        $html = (string) $this->withHeader('Accept-Language', 'de')->get('/melden')->assertOk()->getContent();
        $host = (string) preg_replace('~^https?://~', '', rtrim((string) config('app.url'), '/'));

        expect($html)->toMatch('~<p id="report-url-hint" class="text-caption text-ink-3">Kopier die Adresse aus der Adresszeile, z\. B\. <span class="sc-ident">[^<]*(?:<wbr>[^<]*)*</span></p>~')
            ->and(html_entity_decode(strip_tags((string) preg_replace('~.*<p id="report-url-hint"[^>]*>(.*?)</p>.*~s', '$1', $html))))->toContain($host.'/v/…');
    });
});

describe('running text wraps for an even rag, never by a shorthand (DQ-934, DQ-922, DQ-925)', function () {
    it('gives running text the longhand text-wrap-style and no hyphenate-limit-lines', function () {
        $css = (string) file_get_contents(resource_path('css/public.css'));

        expect($css)->toContain(':where(p, li, dd, blockquote) { text-wrap-style: pretty; }')
            ->and($css)->not->toMatch('~text-wrap:\s*pretty~')
            ->and($css)->not->toMatch('~hyphenate-limit-lines\s*:~')
            ->and($css)->toMatch('~\.sc-ident \{[^}]*hyphens: none;[^}]*\}~');
    });
});
