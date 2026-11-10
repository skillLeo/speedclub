<?php

use App\Models\DataExport;
use App\Models\Media;
use App\Models\Message;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Account\HardDeleteAccount;
use App\Services\Account\WithdrawMemberMedia;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\MemberSessions;
use App\Services\DataExport\BuildDataExport;
use App\Services\DataExport\ExportContents;
use App\Services\Media\MediaService;
use App\Services\PublicPages\OgImages;
use App\Services\Qr\QrCodes;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SettingsTestHelpers.php';
require_once __DIR__.'/../Messaging/MessagingTestHelpers.php';

/**
 * 05_ARCHITECTURE §11: every queued job ends under 50 s. Demo-sized and above: 6 builds with 30 photos each (180 originals of 400 KB, the
 * size a 2560 px JPEG comes to), 120 mods, 400 messages. Each job is timed on its own; the bound is 50 s, the budget of a job 30 s.
 */
beforeEach(function () {
    Mail::fake();
    Storage::fake('local');
    Storage::fake('public');
    config(['speedclub.media.private_disk' => 'local']);
});

function setDemoSizedMember(): User
{
    $member = setMember(['username' => 'perf.member']);
    $friend = setMember();
    $bytes = random_bytes(400 * 1024);

    for ($v = 0; $v < 6; $v++) {
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $member->id]);
        Modification::factory()->count(20)->create(['vehicle_id' => $vehicle->id]);

        foreach (Media::factory()->count(30)->forModel($vehicle)->create(['owner_id' => $member->id]) as $photo) {
            Storage::disk('local')->put((string) $photo->getAttribute('original_path'), $bytes);
        }
    }

    $first = msgStart($member, $friend, 'Start');

    for ($i = 0; $i < 400; $i++) {
        Message::factory()->create(['conversation_id' => $first->conversation_id, 'sender_id' => $i % 2 === 0 ? $member->id : $friend->id]);
    }

    return $member;
}

it('builds a demo-sized export with every job under 50 s', function () {
    $member = setDemoSizedMember();
    $export = DataExport::factory()->create(['user_id' => $member->id]);
    $times = [];

    for ($guard = 0; $guard < 50 && $export->fresh()->status->value !== 'ready'; $guard++) {
        Bus::fake([BuildDataExport::class]);
        $start = microtime(true);
        (new BuildDataExport($export->id))->handle(app(ExportContents::class), app(AuthMailer::class));
        $times[] = microtime(true) - $start;
    }

    $zip = new ZipArchive;
    expect($export->fresh()->status->value)->toBe('ready')
        ->and($zip->open(Storage::disk('local')->path(BuildDataExport::zipPath($export)), ZipArchive::CHECKCONS))->toBeTrue();

    $names = collect(range(0, $zip->numFiles - 1))->map(fn (int $i): string => (string) $zip->getNameIndex($i));
    $documents = count(app(ExportContents::class)->documents($member->fresh() ?? $member));
    $pages = $names->filter(fn (string $name): bool => str_starts_with($name, 'conversations/') || str_starts_with($name, 'notifications/'))->count();

    // 180 originals, the JSON documents (17 since the fix round, M2.6's decisions and appeals included), README.txt and the keyset pages.
    expect($names->filter(fn (string $name): bool => str_starts_with($name, 'photos/'))->count())->toBe(180)
        ->and($names)->toContain('conversations/0001.json', 'README.txt', 'security_events.json')
        ->and($zip->numFiles)->toBe(180 + $documents + 1 + $pages)
        ->and(max($times))->toBeLessThan(50.0);

    fwrite(STDERR, sprintf("\n[perf] export: %d jobs, slowest %.2f s, total %.2f s, %.1f MB\n", count($times), max($times), array_sum($times), $export->fresh()->bytes / 1048576));
})->group('perf');

it('closes and hard-deletes a demo-sized account with every job under 50 s', function () {
    $member = setDemoSizedMember();
    Sanctum::actingAs($member);

    $start = microtime(true);
    Bus::fake([WithdrawMemberMedia::class]);
    $this->postJson('/api/v1/me/delete', ['password' => 'password'])->assertNoContent();
    $request = microtime(true) - $start;

    $start = microtime(true);
    (new WithdrawMemberMedia($member->id))->handle(app(MediaService::class));
    $withdraw = microtime(true) - $start;

    $this->travel(30)->days();
    $start = microtime(true);
    Bus::fake([HardDeleteAccount::class]);
    (new HardDeleteAccount($member->id))->handle(app(MediaService::class), app(QrCodes::class), app(MemberSessions::class), app(OgImages::class));
    $hard = microtime(true) - $start;

    expect(User::withTrashed()->find($member->id))->toBeNull()
        ->and($request)->toBeLessThan(10.0)
        ->and($withdraw)->toBeLessThan(50.0)
        ->and($hard)->toBeLessThan(50.0);

    fwrite(STDERR, sprintf("\n[perf] deletion: request %.2f s, withdraw slice %.2f s, hard delete %.2f s\n", $request, $withdraw, $hard));
})->group('perf');
