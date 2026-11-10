<?php

use Tests\Fixtures\Arch\BadApiController;
use Tests\Fixtures\Arch\GoodApiController;
use Tests\Support\SourceScanner;

/**
 * The scanning rules must detect violations; otherwise a green Arch suite would mean nothing while
 * app/Http/Controllers/Api is still empty.
 */
$fixtures = dirname(__DIR__).'/Fixtures/Arch';

it('detects Eloquent writes through instances and statics', function () use ($fixtures) {
    $calls = SourceScanner::methodCalls((string) file_get_contents("$fixtures/BadApiController.php"), SourceScanner::ELOQUENT_WRITES);

    expect($calls)->toHaveCount(2)
        ->and($calls[0])->toStartWith('save:')
        ->and($calls[1])->toStartWith('create:');
});

it('accepts a controller without Eloquent writes', function () use ($fixtures) {
    expect(SourceScanner::methodCalls((string) file_get_contents("$fixtures/GoodApiController.php"), SourceScanner::ELOQUENT_WRITES))->toBe([]);
});

it('detects API methods that bypass Resources', function () {
    expect(SourceScanner::apiOutputViolations(BadApiController::class))->toBe([
        BadApiController::class.'::model',
        BadApiController::class.'::plainArray',
        BadApiController::class.'::untyped',
        BadApiController::class.'::nullable',
    ]);
});

it('accepts Resources and plain responses', function () {
    expect(SourceScanner::apiOutputViolations(GoodApiController::class))->toBe([]);
});

it('detects response()->json in API controllers', function () use ($fixtures) {
    expect(SourceScanner::methodCalls((string) file_get_contents("$fixtures/BadApiController.php"), ['json']))->toHaveCount(1);
});

it('detects global helpers but not methods or declarations', function () {
    $code = <<<'PHP'
    <?php
    $a = env('A');
    $b = $app->env('B');
    function dump() {}
    \dd($a);
    PHP;

    expect(SourceScanner::functionCalls($code, ['env', 'dump', 'dd']))->toBe(['env:2', 'dd:5']);
});

it('detects helpers in Blade templates', function () {
    $template = "<p>{{ env('A') }}</p>\n@dd(\$x)\n<p>{{ \$app->env('B') }}</p>";

    expect(SourceScanner::bladeCalls($template, ['env', 'dd']))->toBe(['env:1', 'dd:2']);
});
