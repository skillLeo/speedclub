<?php

use App\Enums\ErrorCode;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Tests\Support\SourceScanner;

/**
 * 07_QA_AND_RELEASE §2 architecture layer. The scanning rules read the real directories, so they keep
 * applying to every file added later.
 */
$root = dirname(__DIR__, 2);

arch('php preset')->preset()->php();
arch('security preset')->preset()->security();

arch('no debug helpers in namespaced code')
    ->expect(['dd', 'ddd', 'dump', 'ray', 'var_dump', 'print_r', 'var_export'])
    ->not->toBeUsed();

arch('env() is not used in application code')
    ->expect('env')
    ->not->toBeUsedIn('App');

arch('every model lives in App\Models and extends Eloquent')
    ->expect('App\Models')
    ->classes()
    ->toExtend(Model::class);

arch('no Eloquent model outside App\Models')
    ->expect('App')
    ->classes()
    ->not->toExtend(Model::class)
    ->ignoring('App\Models');

arch('controllers have no direct database access')
    ->expect('App\Http\Controllers')
    ->not->toUse(DB::class);

arch('resources extend JsonResource')
    ->expect('App\Http\Resources')
    ->classes()
    ->toExtend(JsonResource::class);

arch('enums live in App\Enums')
    ->expect('App\Enums')
    ->toBeEnums();

arch('error codes are backed by strings')
    ->expect(ErrorCode::class)
    ->toBeStringBackedEnum();

it('finds no env() outside config/', function () use ($root) {
    $violations = [];

    foreach (SourceScanner::phpFiles(["$root/app", "$root/bootstrap", "$root/database", "$root/routes"]) as $file) {
        if (! str_contains(str_replace('\\', '/', $file), 'bootstrap/cache/')) {
            foreach (SourceScanner::functionCalls((string) file_get_contents($file), ['env']) as $call) {
                $violations[] = "$file $call";
            }
        }
    }

    foreach (SourceScanner::bladeFiles("$root/resources/views") as $file) {
        foreach (SourceScanner::bladeCalls((string) file_get_contents($file), ['env']) as $call) {
            $violations[] = "$file $call";
        }
    }

    expect($violations)->toBe([]);
});

it('finds no debug helpers in routes, migrations, seeders, config or views', function () use ($root) {
    $helpers = ['dd', 'ddd', 'dump', 'ray', 'var_dump'];
    $violations = [];

    foreach (SourceScanner::phpFiles(["$root/config", "$root/database", "$root/routes"]) as $file) {
        foreach (SourceScanner::functionCalls((string) file_get_contents($file), $helpers) as $call) {
            $violations[] = "$file $call";
        }
    }

    foreach (SourceScanner::bladeFiles("$root/resources/views") as $file) {
        foreach (SourceScanner::bladeCalls((string) file_get_contents($file), $helpers) as $call) {
            $violations[] = "$file $call";
        }
    }

    expect($violations)->toBe([]);
});

it('finds no Eloquent writes in controllers', function () use ($root) {
    $violations = [];

    foreach (SourceScanner::phpFiles(["$root/app/Http/Controllers"]) as $file) {
        foreach (SourceScanner::methodCalls((string) file_get_contents($file), SourceScanner::ELOQUENT_WRITES) as $call) {
            $violations[] = "$file $call";
        }
    }

    expect($violations)->toBe([]);
});

it('sends all API output through Resources', function () use ($root) {
    $directory = "$root/app/Http/Controllers/Api";
    $violations = [];

    foreach (SourceScanner::classesIn("$root/app", [$directory]) as $class) {
        $violations = [...$violations, ...SourceScanner::apiOutputViolations($class)];
    }

    foreach (SourceScanner::phpFiles([$directory]) as $file) {
        foreach (SourceScanner::methodCalls((string) file_get_contents($file), ['json']) as $call) {
            $violations[] = "$file $call";
        }
    }

    expect($violations)->toBe([]);
});
