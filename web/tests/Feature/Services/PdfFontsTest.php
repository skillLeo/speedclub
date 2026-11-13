<?php

use App\Services\Pdf\PdfFonts;
use Barryvdh\DomPDF\PDF;
use Illuminate\Support\Facades\File;

/**
 * M4.1 (ADR-402): dompdf names its font cache after the source path, so a font replaced under the same name (Inter 4.001 → 4.1) must not
 * keep printing the old copy. Each test has its own font cache, never the shared storage/fonts.
 */
const PDF_FONTS = [
    ['family' => 'Inter', 'weight' => '400', 'variant' => 'normal', 'file' => 'Inter-Regular.ttf'],
    ['family' => 'Inter Display', 'weight' => '600', 'variant' => '600', 'file' => 'InterDisplay-SemiBold.ttf'],
    ['family' => 'Archivo SemiExpanded', 'weight' => '600', 'variant' => '600', 'file' => 'ArchivoSemiExpanded-SemiBold.ttf'],
];

beforeEach(function () {
    $this->fontDir = storage_path('framework/testing/pdf-fonts-'.bin2hex(random_bytes(6)));
    File::ensureDirectoryExists($this->fontDir);
    config(['dompdf.options.font_dir' => $this->fontDir, 'dompdf.options.font_cache' => $this->fontDir]);
    $this->pdf = fn (): PDF => app('dompdf.wrapper');
    $this->cached = fn (PDF $pdf, array $font): ?string => $pdf->getDomPDF()->getFontMetrics()->getFontFamilies()[mb_strtolower($font['family'])][$font['variant']] ?? null;
});

afterEach(function () {
    File::deleteDirectory($this->fontDir);
});

it('registers every bundled font with a copy that is the bundled file', function () {
    $pdf = ($this->pdf)();
    PdfFonts::register($pdf, PDF_FONTS);

    foreach (PDF_FONTS as $font) {
        $cached = ($this->cached)($pdf, $font);

        expect($cached)->toStartWith($this->fontDir)
            ->and(hash_file('xxh128', $cached.'.ttf'))->toBe(hash_file('xxh128', resource_path('fonts/'.$font['file'])))
            ->and($cached.'.ufm')->toBeFile();
    }
});

it('reuses a current copy without parsing the font again', function () {
    PdfFonts::register(($this->pdf)(), PDF_FONTS);
    $pdf = ($this->pdf)();
    $cached = ($this->cached)($pdf, PDF_FONTS[1]);
    touch($cached.'.ufm', 1_000_000_000);

    PdfFonts::register($pdf, PDF_FONTS);

    expect(filemtime($cached.'.ufm'))->toBe(1_000_000_000);
});

it('replaces a cached copy that is no longer the bundled file', function () {
    PdfFonts::register(($this->pdf)(), PDF_FONTS);
    $pdf = ($this->pdf)();
    $stale = ($this->cached)($pdf, PDF_FONTS[0]);
    // What a host still holds after the update: the old file under the same name.
    copy(resource_path('fonts/Inter-Medium.ttf'), $stale.'.ttf');

    PdfFonts::register($pdf, PDF_FONTS);
    $fresh = ($this->cached)(($this->pdf)(), PDF_FONTS[0]);

    expect(hash_file('xxh128', $fresh.'.ttf'))->toBe(hash_file('xxh128', resource_path('fonts/Inter-Regular.ttf')))
        ->and($fresh.'.ufm')->toBeFile();
});

it('registers again when the metrics are gone', function () {
    PdfFonts::register(($this->pdf)(), PDF_FONTS);
    $pdf = ($this->pdf)();
    unlink(($this->cached)($pdf, PDF_FONTS[2]).'.ufm');

    PdfFonts::register($pdf, PDF_FONTS);

    expect(($this->cached)(($this->pdf)(), PDF_FONTS[2]).'.ufm')->toBeFile();
});

it('never deletes a file outside the font cache', function () {
    $pdf = ($this->pdf)();
    $outside = storage_path('framework/testing/pdf-fonts-outside-'.bin2hex(random_bytes(6)));
    File::ensureDirectoryExists($outside);
    file_put_contents($outside.'/inter_normal.ttf', 'not the bundled font');
    $pdf->getDomPDF()->getFontMetrics()->setFontFamily('inter', ['normal' => $outside.'/inter_normal']);

    PdfFonts::register($pdf, PDF_FONTS);

    expect($outside.'/inter_normal.ttf')->toBeFile()
        ->and(($this->cached)(($this->pdf)(), PDF_FONTS[0]))->toStartWith($this->fontDir);

    File::deleteDirectory($outside);
});

it('reads the family table again under the lock, and reuses what a parallel request registered meanwhile', function () {
    // This request loaded the (empty) family table before the other one registered the fonts and wrote the table to disk.
    $pdf = ($this->pdf)();
    $other = ($this->pdf)();
    PdfFonts::register($other, PDF_FONTS);
    $cached = ($this->cached)($other, PDF_FONTS[1]);
    touch($cached.'.ufm', 1_000_000_000);

    expect(($this->cached)($pdf, PDF_FONTS[1]))->toBeNull();

    PdfFonts::register($pdf, PDF_FONTS);

    // Found under the lock: not parsed and not written again.
    expect(($this->cached)($pdf, PDF_FONTS[1]))->toBe($cached)
        ->and(filemtime($cached.'.ufm'))->toBe(1_000_000_000)
        ->and($this->fontDir.'/'.PdfFonts::LOCK)->toBeFile();
});

it('waits for the lock a parallel request holds before it reads the font cache again', function () {
    // N-8: no timing. This test is the parallel request: it holds the lock while it writes the copies. The request under test runs
    // in a child process, which loaded the (empty) family table before the copies existed, so its lock-free check always fails
    // and it must take the lock. It cannot finish while the lock is held, and once it has the lock it reads the table again and
    // reuses the copies (not parsed, not written again).
    $lock = fopen($this->fontDir.'/'.PdfFonts::LOCK, 'c');
    expect($lock)->toBeResource()
        ->and(flock($lock, LOCK_EX | LOCK_NB))->toBeTrue();

    $child = proc_open(
        [PHP_BINARY, '-r', <<<'PHP'
            require $argv[1].'/vendor/autoload.php';
            $app = require $argv[1].'/bootstrap/app.php';
            $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
            config(['dompdf.options.font_dir' => $argv[2], 'dompdf.options.font_cache' => $argv[2]]);
            $pdf = app('dompdf.wrapper');
            echo "ready\n";
            App\Services\Pdf\PdfFonts::register($pdf, json_decode($argv[3], true));
            echo json_encode($pdf->getDomPDF()->getFontMetrics()->getFontFamilies()), "\n";
            PHP, base_path(), $this->fontDir, json_encode(PDF_FONTS)],
        [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
        $pipes,
    );
    expect($child)->toBeResource()
        ->and(trim((string) fgets($pipes[1])))->toBe('ready');

    // Under the lock: what a parallel request writes, then a marker on each copy's metrics.
    $metrics = ($this->pdf)()->getDomPDF()->getFontMetrics();
    $cached = [];
    foreach (PDF_FONTS as $font) {
        expect($metrics->registerFont(['family' => $font['family'], 'weight' => $font['weight'], 'style' => 'normal'], resource_path('fonts/'.$font['file'])))->toBeTrue();
        $cached[] = $metrics->getFontFamilies()[mb_strtolower($font['family'])][$font['variant']];
    }
    foreach ($cached as $copy) {
        touch($copy.'.ufm', 1_000_000_000);
    }

    // The child had all the time the font parsing took, and has not finished: it waits for the lock.
    stream_set_blocking($pipes[1], false);
    expect(fgets($pipes[1]))->toBeFalse()
        ->and(proc_get_status($child)['running'])->toBeTrue();

    flock($lock, LOCK_UN);
    fclose($lock);
    stream_set_blocking($pipes[1], true);
    $families = json_decode((string) stream_get_contents($pipes[1]), true);
    $errors = (string) stream_get_contents($pipes[2]);
    $exit = proc_close($child);

    expect($exit)->toBe(0, $errors)
        ->and(is_array($families))->toBeTrue($errors);

    foreach (PDF_FONTS as $index => $font) {
        expect($families[mb_strtolower($font['family'])][$font['variant']] ?? null)->toBe($cached[$index])
            ->and(filemtime($cached[$index].'.ufm'))->toBe(1_000_000_000);
    }
});

it('runs unlocked when the lock file cannot be opened in the font dir (N-3)', function () {
    // A directory where the lock file belongs: fopen fails with a warning, which Laravel would turn into an exception.
    mkdir($this->fontDir.'/'.PdfFonts::LOCK);
    $pdf = ($this->pdf)();

    PdfFonts::register($pdf, PDF_FONTS);

    foreach (PDF_FONTS as $font) {
        expect(($this->cached)($pdf, $font))->toStartWith($this->fontDir)
            ->and(($this->cached)($pdf, $font).'.ufm')->toBeFile();
    }
});
