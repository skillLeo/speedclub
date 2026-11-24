<?php

use App\Models\DeviceInstall;
use App\Models\User;
use App\Services\Auth\DeviceInstalls;
use App\Services\DataExport\ExportContents;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

/**
 * ADR-511 (amends ADR-435): device_installs.install_key, the install without the member, written at sign-in and token rotation so the
 * Spots admin can see several spotting accounts on one app install. The per-member hash stays as it was; the plain install id is stored
 * nowhere; the key is in no member answer and not in the data export.
 */
beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
    config(['speedclub.email_code.min_response_ms' => 0]);
});

function installKeyLogin(User $user, string $install): string
{
    $token = (string) test()->postJson('/api/v1/auth/login', [
        'email' => $user->email, 'password' => 'password', 'device_name' => 'Pixel 9', 'platform' => 'android',
        'app_version' => '2.1.0', 'os_version' => '16', 'device_id' => $install,
    ])->assertOk()->json('data.token');
    app('auth')->forgetGuards();
    test()->flushHeaders();
    test()->withHeader('Accept-Language', 'de');

    return $token;
}

it('writes the same member-free key on both members\' rows of one install, next to two different per-member hashes', function () {
    $a = User::factory()->create();
    $b = User::factory()->create();
    $c = User::factory()->create();
    installKeyLogin($a, 'install-shared-0511');
    installKeyLogin($b, 'install-shared-0511');
    installKeyLogin($c, 'install-other-0511');

    $rows = DB::table('device_installs')->get(['user_id', 'install_id_hash', 'install_key'])->keyBy('user_id');

    expect($rows)->toHaveCount(3)
        ->and($rows[$a->id]->install_key)->toBe(DeviceInstalls::installKey('install-shared-0511'))
        ->and($rows[$b->id]->install_key)->toBe($rows[$a->id]->install_key)
        ->and($rows[$a->id]->install_id_hash)->not->toBe($rows[$b->id]->install_id_hash)
        ->and($rows[$c->id]->install_key)->not->toBe($rows[$a->id]->install_key);

    // The plain install id is stored in no column of the table.
    expect(json_encode(DB::table('device_installs')->get(), JSON_THROW_ON_ERROR))->not->toContain('install-shared-0511');
});

it('fills the key on an install row from before ADR-511 at the next sign-in', function () {
    $user = User::factory()->create();
    $old = DeviceInstall::factory()->for($user)->create([
        'install_id_hash' => DeviceInstalls::key((string) $user->id, 'install-old-0511'),
        'install_key' => null,
    ]);

    installKeyLogin($user, 'install-old-0511');

    expect(DeviceInstall::query()->whereKey($old->id)->value('install_key'))->toBe(DeviceInstalls::installKey('install-old-0511'))
        ->and(DeviceInstall::query()->where('user_id', $user->id)->count())->toBe(1);
});

it('never shows the key to the member: not in the sessions list, the data export or a serialised install', function () {
    $user = User::factory()->create();
    $token = installKeyLogin($user, 'install-mine-0511');
    $key = DeviceInstalls::installKey('install-mine-0511');

    $sessions = test()->withToken($token)->getJson('/api/v1/me/sessions')->assertOk();

    $export = app(ExportContents::class)->documents($user)['device_installs.json'];

    expect($sessions->getContent())->not->toContain($key)
        ->and($export)->toHaveCount(1)
        ->and(json_encode($export, JSON_THROW_ON_ERROR))->not->toContain($key)
        ->and(DeviceInstall::query()->where('user_id', $user->id)->firstOrFail()->toArray())->not->toHaveKey('install_key');
});
