<?php

use App\Enums\DataExportStatus;
use App\Enums\MemberSecurityEvent;
use App\Mail\DataExportReadyMail;
use App\Models\AuditEvent;
use App\Models\Block;
use App\Models\DataExport;
use App\Models\Follow;
use App\Models\Media;
use App\Models\Modification;
use App\Models\SupportTicket;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Auth\AuthMailer;
use App\Services\DataExport\BuildDataExport;
use App\Services\DataExport\ExportContents;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SettingsTestHelpers.php';

beforeEach(function () {
    // Symfony's test requests say en-us; the copy checked here is German.
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
    Storage::fake('local');
    config(['speedclub.media.private_disk' => 'local']);
});

/**
 * A member with a build, a mod, photos with originals on the private disk, follows both ways, a block and a ticket.
 */
function setRichMember(int $photos = 3): User
{
    $member = setMember(['username' => 'lukas.sc', 'email' => 'lukas@example.de', 'city' => 'Köln']);
    $vehicle = Vehicle::factory()->published()->create(['owner_id' => $member->id, 'nickname' => 'Godzilla']);
    Modification::factory()->create(['vehicle_id' => $vehicle->id]);

    for ($i = 0; $i < $photos; $i++) {
        $photo = Media::factory()->forModel($vehicle)->create(['owner_id' => $member->id]);
        Storage::disk('local')->put((string) $photo->getAttribute('original_path'), 'JPEG-BYTES-'.$i.str_repeat('x', 2000));
    }

    $friend = setMember(['username' => 'sara.gti']);
    Follow::factory()->create(['follower_id' => $member->id, 'followee_id' => $friend->id]);
    Follow::factory()->create(['follower_id' => $friend->id, 'followee_id' => $member->id]);
    $blocked = setMember(['username' => 'nina.neu']);
    Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => $blocked->id, 'blocked_username' => 'nina.neu']);
    SupportTicket::factory()->create(['user_id' => $member->id]);

    return $member;
}

it('queues an export, builds a valid ZIP of JSON and photo originals, and mails a signed 7-day link', function () {
    $member = setRichMember();
    Sanctum::actingAs($member);

    $response = $this->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(202);
    $export = DataExport::query()->findOrFail($response->json('data.id'));

    expect($export->status)->toBe(DataExportStatus::Ready)
        ->and($export->expires_at?->diffInDays($export->ready_at, true))->toEqualWithDelta(7, 0.01);

    $files = setReadZip($export);
    expect(array_keys($files))->toContain('README.txt', 'profile.json', 'settings.json', 'consents.json', 'vehicles.json', 'photos.json', 'follows.json', 'blocks.json', 'saves.json', 'reports.json', 'support_tickets.json', 'devices.json', 'security_events.json', 'reactions.json', 'push_devices.json', 'browser_sessions.json')
        ->and(collect(array_keys($files))->filter(fn ($name) => str_starts_with($name, 'photos/'))->count())->toBe(3);

    $profile = json_decode($files['profile.json'], true);
    $follows = json_decode($files['follows.json'], true);
    expect($profile['email'])->toBe('lukas@example.de')->and($profile['username'])->toBe('lukas.sc')
        ->and($follows['following'][0])->toBe(['username' => 'sara.gti', 'since' => $follows['following'][0]['since']])
        ->and(json_decode($files['blocks.json'], true)[0]['username'])->toBe('nina.neu')
        ->and(json_decode($files['vehicles.json'], true)[0]['modifications'])->toHaveCount(1)
        ->and($files['README.txt'])->toContain('Datenexport')->toContain('data export');

    // Never a secret, never an address of the network.
    $all = implode("\n", $files);
    expect($all)->not->toContain($member->getAuthPassword())->not->toContain('203.0.113')->not->toContain('two_factor_secret');

    Mail::assertSent(DataExportReadyMail::class, fn (DataExportReadyMail $mail): bool => $mail->hasTo('lukas@example.de') && str_contains($mail->downloadUrl, 'signature='));
    expect(AuditEvent::query()->where('action', MemberSecurityEvent::DataExportRequested->value)->exists())->toBeTrue();

    $this->getJson('/api/v1/me/exports')->assertOk()
        ->assertJsonPath('data.0.status', 'ready')
        ->assertJsonPath('data.0.id', $export->id);
});

it('serves the ZIP to the signed link only, and never a changed or expired one', function () {
    $member = setRichMember(1);
    Sanctum::actingAs($member);
    $id = $this->postJson('/api/v1/me/export', ['password' => 'password'])->json('data.id');
    $url = (string) $this->getJson('/api/v1/me/exports')->json('data.0.download_url');
    app('auth')->forgetGuards();

    $this->app['auth']->guard('sanctum')->forgetUser();
    $download = $this->get($url)->assertOk();
    expect($download->headers->get('Content-Type'))->toBe('application/zip')
        ->and((string) $download->headers->get('Cache-Control'))->toContain('no-store');

    $this->get(str_replace($id, strtoupper($id), $url))->assertForbidden();
    $this->get(preg_replace('/signature=[^&]+/', 'signature=00', $url))->assertForbidden();

    $this->travel(8)->days();
    $this->get($url)->assertForbidden();
});

it('allows one export per 24 hours, but a failed one does not count', function () {
    $member = setMember();
    Sanctum::actingAs($member);

    $this->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(202);
    $this->postJson('/api/v1/me/export', ['password' => 'password'])
        ->assertStatus(429)->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After')
        ->assertJsonStructure(['retry_at']);

    DataExport::query()->update(['status' => DataExportStatus::Failed]);
    $this->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(202);

    $this->travel(25)->hours();
    $this->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(202);
});

it('needs the password', function () {
    Sanctum::actingAs(setMember());

    $this->postJson('/api/v1/me/export', ['password' => 'falsch-falsch'])->assertUnprocessable()->assertJsonValidationErrors('password');
    $this->postJson('/api/v1/me/export', [])->assertUnprocessable()->assertJsonValidationErrors('password');
    expect(DataExport::query()->count())->toBe(0);
});

it('replays the same answer for the same Idempotency-Key', function () {
    Sanctum::actingAs(setMember());

    $first = $this->withHeader('Idempotency-Key', 'export-key-0001')->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(202);
    $this->withHeader('Idempotency-Key', 'export-key-0001')->postJson('/api/v1/me/export', ['password' => 'password'])
        ->assertStatus(202)->assertJsonPath('data.id', $first->json('data.id'));
    expect(DataExport::query()->count())->toBe(1);
});

it('builds the photos in slices and survives a retried slice', function () {
    config(['speedclub.data_export.photos_per_job' => 2]);
    $member = setRichMember(5);
    Sanctum::actingAs($member);

    $id = $this->postJson('/api/v1/me/export', ['password' => 'password'])->json('data.id');
    $export = DataExport::query()->findOrFail($id);
    $first = setReadZip($export);
    expect(collect(array_keys($first))->filter(fn ($name) => str_starts_with($name, 'photos/'))->count())->toBe(5);

    // Run the same export again from a half-written state: stage photos, offset after the JSON.
    $export->forceFill(['status' => DataExportStatus::Running, 'progress' => null])->save();
    Storage::disk('local')->put(BuildDataExport::zipPath($export), 'garbage left by a killed job');
    (new BuildDataExport($export->id))->handle(app(ExportContents::class), app(AuthMailer::class));

    expect(array_keys(setReadZip($export->fresh())))->toEqualCanonicalizing(array_keys($first));
});

it('prunes the file after 7 days and marks the export expired', function () {
    $member = setMember();
    Sanctum::actingAs($member);
    $id = $this->postJson('/api/v1/me/export', ['password' => 'password'])->json('data.id');
    $export = DataExport::query()->findOrFail($id);
    expect(Storage::disk('local')->exists(BuildDataExport::zipPath($export)))->toBeTrue();

    $this->travel(8)->days();
    $this->artisan('exports:prune')->assertSuccessful();

    expect($export->fresh()->status)->toBe(DataExportStatus::Expired)
        ->and(Storage::disk('local')->exists(BuildDataExport::zipPath($export)))->toBeFalse();
    $this->getJson('/api/v1/me/exports')->assertJsonPath('data.0.status', 'expired')->assertJsonPath('data.0.download_url', null);
});

it('fails a stuck export so the member can ask again', function () {
    $member = setMember();
    $stuck = DataExport::factory()->create(['user_id' => $member->id, 'status' => DataExportStatus::Running, 'requested_at' => now()->subHours(7)]);

    $this->artisan('exports:prune')->assertSuccessful();

    expect($stuck->fresh()->status)->toBe(DataExportStatus::Failed);
});

it('lists only the member\'s own exports', function () {
    $member = setMember();
    DataExport::factory()->ready()->create();
    DataExport::factory()->create(['user_id' => $member->id]);
    Sanctum::actingAs($member);

    $this->getJson('/api/v1/me/exports')->assertOk()->assertJsonCount(1, 'data');
});
