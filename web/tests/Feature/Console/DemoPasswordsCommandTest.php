<?php

use App\Console\Commands\DemoPasswordsCommand;
use App\Models\User;
use App\Services\Auth\LoginThrottle;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Round 5 (client login on staging): speedclub:demo-passwords puts DEMO_MEMBER_PASSWORD on every demo account, once, and never prints it.
 */
const DEMO_PASSWORDS_SECRET = 'Demo-Zugang-für-den-Test-42';

function demoPasswordsHost(string $environment = 'staging'): void
{
    app()->detectEnvironment(fn () => $environment);
    config(['app.env' => $environment, 'speedclub.demo.member_password' => DEMO_PASSWORDS_SECRET]);
}

function demoMember(string $username, ?string $password = 'ein-altes-passwort', string $domain = 'speedclub.test'): User
{
    return User::factory()->create(['username' => $username, 'email' => "$username@$domain", 'password' => $password]);
}

it('sets the demo password on every demo account that does not have it, and nothing else', function () {
    demoPasswordsHost();
    $sebastian = demoMember('sebastian.demo');
    $lukas = demoMember('lukas.sc', DEMO_PASSWORDS_SECRET);
    $lukasHash = $lukas->password;
    $real = demoMember('echt.mitglied', 'mein-eigenes-passwort', 'example.com');
    $fixture = demoMember('e2e.fixture', 'fixture-passwort', 'e2e.speedclub.test');
    $deleted = demoMember('weg.demo');
    $deleted->delete();

    $this->artisan('speedclub:demo-passwords')->assertSuccessful()->expectsOutputToContain('Password set on 1 of 2 demo accounts: sebastian.demo');

    expect(Hash::check(DEMO_PASSWORDS_SECRET, $sebastian->refresh()->password))->toBeTrue()
        // A hash that already matches stays, so its sessions stay signed in.
        ->and($lukas->refresh()->password)->toBe($lukasHash)
        ->and(Hash::check('mein-eigenes-passwort', $real->refresh()->password))->toBeTrue()
        ->and(Hash::check('fixture-passwort', $fixture->refresh()->password))->toBeTrue()
        ->and(Hash::check(DEMO_PASSWORDS_SECRET, User::withTrashed()->findOrFail($deleted->id)->password))->toBeFalse()
        ->and(DB::table('audit_events')->where('action', DemoPasswordsCommand::AUDIT_ACTION)->count())->toBe(1);
});

it('changes nothing on a second run', function () {
    demoPasswordsHost();
    $sebastian = demoMember('sebastian.demo');

    $this->artisan('speedclub:demo-passwords')->assertSuccessful();
    $hash = $sebastian->refresh()->password;

    $this->artisan('speedclub:demo-passwords')->assertSuccessful()->expectsOutputToContain('Password set on 0 of 1 demo accounts (all already sign in with DEMO_MEMBER_PASSWORD)');

    expect($sebastian->refresh()->password)->toBe($hash)
        ->and(DB::table('audit_events')->where('action', DemoPasswordsCommand::AUDIT_ACTION)->count())->toBe(1);
});

it('never prints the password', function () {
    demoPasswordsHost();
    demoMember('sebastian.demo');

    Artisan::call('speedclub:demo-passwords');
    $output = Artisan::output();
    Artisan::call('speedclub:demo-passwords', ['--dry-run' => true]);
    $output .= Artisan::output();

    expect($output)->not->toContain(DEMO_PASSWORDS_SECRET)
        ->and((string) json_encode(DB::table('audit_events')->get()))->not->toContain(DEMO_PASSWORDS_SECRET);
});

it('only counts on a dry run', function () {
    demoPasswordsHost();
    $sebastian = demoMember('sebastian.demo');
    $hash = $sebastian->password;

    $this->artisan('speedclub:demo-passwords', ['--dry-run' => true])->assertSuccessful()->expectsOutputToContain('Dry run: would set the password on 1 of 1 demo accounts');

    expect($sebastian->refresh()->password)->toBe($hash)
        ->and(DB::table('audit_events')->where('action', DemoPasswordsCommand::AUDIT_ACTION)->count())->toBe(0);
});

it('lifts the sign-in delay of the demo accounts', function () {
    demoPasswordsHost();
    config(['speedclub.login_delay.free_failures' => 1]);
    $sebastian = demoMember('sebastian.demo', DEMO_PASSWORDS_SECRET);
    $throttle = app(LoginThrottle::class);
    $throttle->recordFailure(LoginThrottle::accountSubject($sebastian));
    $throttle->recordFailure('sebastian.demo@speedclub.test');
    expect($throttle->secondsUntilAllowed(LoginThrottle::accountSubject($sebastian)))->toBeGreaterThan(0);

    $this->artisan('speedclub:demo-passwords')->assertSuccessful();

    expect($throttle->secondsUntilAllowed(LoginThrottle::accountSubject($sebastian)))->toBe(0)
        ->and($throttle->secondsUntilAllowed('sebastian.demo@speedclub.test'))->toBe(0);

    $this->postJson('/api/v1/auth/login', ['email' => 'sebastian.demo@speedclub.test', 'password' => DEMO_PASSWORDS_SECRET, 'device_name' => 'Pest'])->assertOk();
});

it('refuses without the demo password', function () {
    demoPasswordsHost();
    config(['speedclub.demo.member_password' => '']);
    $sebastian = demoMember('sebastian.demo');
    $hash = $sebastian->password;

    $this->artisan('speedclub:demo-passwords')->assertFailed()->expectsOutputToContain('DEMO_MEMBER_PASSWORD is not set');

    expect($sebastian->refresh()->password)->toBe($hash);
});

it('refuses outside local and staging', function (string $environment) {
    demoPasswordsHost($environment);
    $sebastian = demoMember('sebastian.demo');
    $hash = $sebastian->password;

    $this->artisan('speedclub:demo-passwords')->assertFailed();

    expect($sebastian->refresh()->password)->toBe($hash);
})->with(['production', 'testing', 'demo']);
