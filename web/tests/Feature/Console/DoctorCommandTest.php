<?php

use App\Enums\DoctorLevel;
use App\Services\Audit\AuditChain;
use App\Support\Doctor\DoctorResult;
use App\Support\Doctor\EnvironmentDoctor;
use Dotenv\Dotenv;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Http;

it('passes with warnings when optional services are missing', function () {
    config([
        'broadcasting.default' => 'log',
        'mail.default' => 'log',
    ]);

    $exitCode = Artisan::call('speedclub:doctor');
    $output = Artisan::output();

    expect($exitCode)->toBe(0)
        ->and($output)->toContain('No blockers')
        ->toContain('WARN')
        ->toContain('Pusher')
        ->toContain('Mail')
        ->toContain('PHP extensions')
        ->toContain('GD WebP + FreeType')
        ->toContain('Writable directories')
        ->toContain('Database')
        ->toContain('Cron heartbeat')
        ->toContain('Storage link')
        ->toContain('Queue');
});

it('warns about logs the privacy policy cannot keep its promise on', function (array $settings, string $message) {
    config(['logging.default' => 'stack', 'logging.channels.stack.channels' => ['daily'], 'logging.channels.daily.days' => 14, ...$settings]);

    expect(Artisan::call('speedclub:doctor'))->toBe(0)
        ->and(preg_replace('/\s+/', ' ', Artisan::output()))->toContain($message);
})->with([
    'never rotated' => [['logging.channels.stack.channels' => ['single']], 'never rotates'],
    'kept too long' => [['logging.channels.daily.days' => 30], 'LOG_DAILY_DAYS is 30'],
    'kept forever' => [['logging.channels.daily.days' => 0], 'LOG_DAILY_DAYS is 0'],
    'fine' => [[], 'daily, 14 days'],
]);

it('warns when Pusher is selected without keys', function () {
    config([
        'broadcasting.default' => 'pusher',
        'broadcasting.connections.pusher.key' => null,
    ]);

    expect(Artisan::call('speedclub:doctor'))->toBe(0)
        ->and(Artisan::output())->toContain('clients use polling');
});

it('fails on a blocker: database unreachable', function () {
    $default = config('database.default');
    config([
        'database.connections.broken' => [...config('database.connections.mysql'), 'port' => 1],
        'database.default' => 'broken',
    ]);

    $exitCode = Artisan::call('speedclub:doctor');
    $output = Artisan::output();

    config(['database.default' => $default]);

    expect($exitCode)->toBe(1)
        ->and($output)->toContain('BLOCKER')
        ->toContain('Fix the blockers');
});

it('fails on a blocker: missing APP_KEY', function () {
    config(['app.key' => '']);

    expect(Artisan::call('speedclub:doctor'))->toBe(1)
        ->and(Artisan::output())->toContain('APP_KEY');
});

it('reports the audit triggers when they are present', function () {
    expect(Artisan::call('speedclub:doctor'))->toBe(0)
        ->and(preg_replace('/\s+/', ' ', Artisan::output()))->toContain('Append-only triggers present');
});

it('warns without failing when the audit triggers are missing', function () {
    // DDL commits implicitly, so this leaves the transaction of RefreshDatabase and puts the trigger back itself.
    DB::rollBack();
    DB::unprepared('DROP TRIGGER IF EXISTS audit_events_no_delete');

    try {
        expect(Artisan::call('speedclub:doctor'))->toBe(0)
            ->and(preg_replace('/\s+/', ' ', Artisan::output()))->toContain('Missing: audit_events_no_delete');
    } finally {
        DB::unprepared(AuditChain::triggerStatements()[1]);
    }
});

it('warns about an https site with insecure session cookies', function () {
    config(['app.url' => 'https://speedclub.test', 'session.secure' => false]);

    expect(Artisan::call('speedclub:doctor'))->toBe(0)
        ->and(preg_replace('/\s+/', ' ', Artisan::output()))->toContain('SESSION_SECURE_COOKIE is off');
});

it('fails on a blocker: the common-password list is missing or too small', function (?string $content) {
    $path = storage_path('framework/testing/doctor-passwords-'.bin2hex(random_bytes(4)).'.txt');

    if ($content !== null) {
        File::ensureDirectoryExists(dirname($path));
        File::put($path, $content);
    }

    config()->set('speedclub.passwords.common_list', $path);

    $exitCode = Artisan::call('speedclub:doctor');
    File::delete($path);

    expect($exitCode)->toBe(1)
        ->and(Artisan::output())->toContain('Common passwords');
})->with([
    'missing' => [null],
    'only unreachable entries' => ["password\n123456\n"],
]);

it('reports the common-password list when it is fine', function () {
    Artisan::call('speedclub:doctor');

    expect(Artisan::output())->toContain('Common passwords')->toContain('entries can match');
});

describe('directory listing of the public disk', function () {
    beforeEach(function () {
        config(['app.url' => 'https://speedclub.test', 'speedclub.media.disk' => 'public']);
    });

    function listingResult(): DoctorResult
    {
        $result = collect(app(EnvironmentDoctor::class)->run())->first(fn (DoctorResult $result): bool => $result->check === 'Directory listing');
        expect($result)->toBeInstanceOf(DoctorResult::class);

        return $result;
    }

    it('asks the site for each folder as a stranger would, and passes when none lists', function () {
        Http::fake(['*' => Http::response('Forbidden', 403)]);

        expect(listingResult()->level)->toBe(DoctorLevel::Ok);

        Http::assertSentCount(3);
        Http::assertSent(fn (HttpRequest $request): bool => $request->url() === 'https://speedclub.test/storage/og/v/');
        Http::assertSent(fn (HttpRequest $request): bool => $request->url() === 'https://speedclub.test/storage/media/');
    });

    it('blocks production and warns elsewhere when the host lists a folder', function (string $environment, DoctorLevel $level) {
        Http::fake([
            'speedclub.test/storage/og/v/' => Http::response('<html><head><title>Index of /storage/og/v</title></head>', 200),
            '*' => Http::response('Not Found', 404),
        ]);
        app()->detectEnvironment(fn (): string => $environment);

        $result = listingResult();

        expect($result->level)->toBe($level)
            ->and($result->detail)->toContain('/storage/og/v/')->not->toContain('/storage/media/');
    })->with([
        'production' => ['production', DoctorLevel::Blocker],
        'staging' => ['staging', DoctorLevel::Warning],
    ]);

    it('says what to check by hand when the site does not answer', function () {
        Http::fake(['*' => Http::failedConnection('Connection refused')]);

        $result = listingResult();

        expect($result->level)->toBe(DoctorLevel::Warning)
            ->and($result->detail)->toContain('https://speedclub.test/storage/media/')->toContain('Check by hand');
    });

    it('has nothing to ask when the media are not served from this host', function () {
        config(['speedclub.media.disk' => 's3', 'filesystems.disks.s3.driver' => 's3']);
        Http::fake();

        expect(listingResult()->level)->toBe(DoctorLevel::Ok);

        Http::assertNothingSent();
    });
});

it('renders its table on the string values of .env.production.example', function () {
    // A real host hands env() strings; the other cases inject integers through config() and cannot see a missing cast.
    $example = Dotenv::parse(File::get(base_path('.env.production.example')));
    $keys = ['LOG_CHANNEL', 'LOG_DAILY_DAYS', 'MAIL_MAILER', 'MAIL_HOST', 'MAIL_PORT'];
    $server = array_intersect_key($_SERVER, array_flip($keys));
    $env = array_intersect_key($_ENV, array_flip($keys));

    try {
        foreach ($keys as $key) {
            $_SERVER[$key] = $_ENV[$key] = $example[$key];
        }

        config(['logging' => require config_path('logging.php'), 'mail' => require config_path('mail.php')]);
    } finally {
        foreach ($keys as $key) {
            unset($_SERVER[$key], $_ENV[$key]);
        }

        $_SERVER += $server;
        $_ENV += $env;
    }

    expect(config('logging.channels.daily.days'))->toBe(14)
        ->and(config('mail.mailers.smtp.port'))->toBe(465);

    Artisan::call('speedclub:doctor');

    expect(Artisan::output())->toContain('daily, 14 days')->toContain('MAIL_HOST is not set')->toContain('Common passwords');
});
