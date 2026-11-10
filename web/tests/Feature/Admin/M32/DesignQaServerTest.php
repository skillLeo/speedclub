<?php

use App\Enums\ApprovalStatus;
use App\Enums\DevicePlatform;
use App\Enums\ModerationStatus;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\KnownDevice;
use App\Models\Media;
use App\Models\Modification;
use App\Models\User;
use App\Services\Admin\Members\DeviceLabel;
use App\Services\Approvals\Approvals;
use App\Services\Auth\KnownDevices;
use App\Support\Auth\DeviceInfo;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/*
 * Server side of the M3.2 design-QA round (DQ-528, 532, 535, 536, 541): the hidden photo's original behind an audited, signed reveal;
 * the countdown and failed records of ADM-43; focal point and blurhash placeholder of vehicle covers; device names of known devices;
 * the mod category glyph.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    Storage::fake('public');
    Storage::fake(config()->string('speedclub.media.private_disk'));
    $this->owner = User::factory()->create(['username' => 'jonas.dq', 'locale' => 'de']);
    $this->vehicle = modVehicle($this->owner)->refresh();
});

/** A photo a decision removed, with its private original on the private disk. */
function adm32HiddenPhoto(object $test): Media
{
    $photo = modPhoto($test->vehicle);
    $path = 'media/'.strtolower($photo->id).'/abc123.jpg';
    Storage::disk(config()->string('speedclub.media.private_disk'))->put($path, 'JPEGBYTES');
    $photo->forceFill(['original_path' => $path, 'moderation_status' => ModerationStatus::Rejected])->save();

    return $photo;
}

describe('DQ-532 original of a hidden photo', function () {
    it('lets media.review reveal the original, audited, as a signed URL', function () {
        $photo = adm32HiddenPhoto($this);
        assertAdminMatrix('POST', '/admin/media-review/'.$photo->id.'/original', ['owner', 'admin', 'moderator'], function (TestResponse $r) {
            $r->assertOk()->assertJsonStructure(['url', 'expires_in']);
            expect($r->json('url'))->toContain('signature=')->not->toContain('abc123');
        });
        expect(AuditEvent::query()->where('action', 'media.original_viewed')->where('target_id', $photo->id)->count())->toBe(3);
    });

    it('refuses the analyst', function () {
        $photo = adm32HiddenPhoto($this);
        adm32SignedIn('analyst');
        expect($this->postJson('/admin/media-review/'.$photo->id.'/original')->status())->toBe(403);
    });

    it('answers 404 for a photo that is not removed, a chat photo, or one without its original', function () {
        $visible = modPhoto($this->vehicle);
        $gone = adm32HiddenPhoto($this);
        Storage::disk(config()->string('speedclub.media.private_disk'))->delete((string) $gone->original_path);
        $chat = Media::factory()->create(['owner_id' => $this->owner->id, 'mediable_type' => 'message', 'mediable_id' => strtolower((string) Str::ulid()), 'moderation_status' => ModerationStatus::Rejected]);
        adm32SignedIn('moderator');

        foreach ([$visible, $gone, $chat] as $media) {
            expect($this->postJson('/admin/media-review/'.$media->id.'/original')->status())->toBe(404);
        }
        expect(AuditEvent::query()->where('action', 'media.original_viewed')->count())->toBe(0);
    });

    it('serves the original only through the signed URL, private and never cached', function () {
        $photo = adm32HiddenPhoto($this);
        adm32SignedIn('moderator');

        $url = $this->postJson('/admin/media-review/'.$photo->id.'/original')->json('url');
        $this->get($url)->assertOk()
            ->assertHeader('Content-Type', 'image/jpeg')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Content-Disposition', 'inline')
            ->assertSee('JPEGBYTES', false)
            ->tap(fn (TestResponse $r) => expect((string) $r->headers->get('Cache-Control'))->toContain('no-store')->toContain('private'));

        expect($this->get('/admin/media-review/'.$photo->id.'/original')->status())->toBe(403);
        $expired = URL::temporarySignedRoute('admin.media.original.file', now()->subMinute(), ['media' => $photo->id], absolute: false);
        expect($this->get($expired)->status())->toBe(403);
    });

    it('needs a sign-in and the atom for the file route too', function () {
        $photo = adm32HiddenPhoto($this);
        $url = URL::temporarySignedRoute('admin.media.original.file', now()->addMinutes(5), ['media' => $photo->id], absolute: false);
        assertAdminMatrix('GET', $url, ['owner', 'admin', 'moderator'], fn (TestResponse $r) => $r->assertOk());
    });

    it('gives the Ausgeblendet tab the placeholder, the removal and whether it can be revealed', function () {
        $photo = modPhoto($this->vehicle);
        adm32SignedIn('moderator');
        $this->from('/admin/media-review')->post('/admin/media-review/'.$photo->id.'/hide', [...adm32Statement(), 'reason' => adm32Reason()])->assertStatus(303);

        $this->get('/admin/media-review?tab=hidden')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('items.data.0.id', $photo->id)
            ->where('items.data.0.placeholder', fn ($v) => is_string($v) && str_starts_with($v, 'data:image/png;base64,'))
            ->where('items.data.0.hidden.ground', 'Respektvoller Umgang')
            ->has('items.data.0.hidden.at')
            ->where('items.data.0.can_reveal', true)
            ->missing('items.data.0.original_path'));

        $this->get('/admin/media-review')->assertInertia(fn (AssertableInertia $p) => $p->has('items.data', 0));
    });
});

describe('DQ-528 ADM-43 countdown and failed records', function () {
    it('sends the seconds left on the server clock', function () {
        seedStaffRoles();
        $member = User::factory()->create(['username' => 'anna.dq']);
        app(Approvals::class)->request('members.export', ['member_id' => $member->id], adm32Reason(), staffWithRole('owner'), $member);
        adm32SignedIn('admin');

        $this->get('/admin/team/approvals')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('requests.0.expires_in', fn (int $s) => $s > 23 * 3600 && $s <= 24 * 3600)
            ->where('requests.0.result.failed_rows', []));
    });

    it('names the records an executed bulk run could not change', function () {
        seedStaffRoles();
        $admin = adm32SignedIn('admin');
        $members = User::factory()->count(3)->sequence(['username' => 'a.dq'], ['username' => 'b.dq'], ['username' => 'c.dq'])->create();
        $ids = $members->pluck('id')->all();
        $request = app(Approvals::class)->request('members.bulk', ['action' => 'revoke_sessions', 'ids' => $ids, 'options' => []], adm32Reason(), $admin);
        $request->forceFill(['status' => ApprovalStatus::Executed, 'pending_key' => null, 'executed_at' => now(), 'result' => [
            'done' => 1, 'failed' => 2, 'rows' => [
                ['id' => $ids[0], 'ok' => true, 'code' => null],
                ['id' => $ids[1], 'ok' => false, 'code' => 'not_possible'],
                ['id' => '01jzzzzzzzzzzzzzzzzzzzzzzz', 'ok' => false, 'code' => 'not_found'],
            ],
        ]])->save();

        $this->get('/admin/team/approvals?tab=mine')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('requests.0.status', 'executed')
            ->where('requests.0.expires_in', 0)
            ->where('requests.0.result.failed', 2)
            ->where('requests.0.result.failed_rows', [
                ['id' => $ids[1], 'label' => '@b.dq', 'code' => 'not_possible'],
                ['id' => '01jzzzzzzzzzzzzzzzzzzzzzzz', 'label' => '01jzzzzzzzzzzzzzzzzzzzzzzz', 'code' => 'not_found'],
            ]));
        expect(ApprovalRequest::query()->count())->toBe(1);
    });
});

describe('DQ-536 covers, DQ-535 mod glyph', function () {
    it('sends the focal point and a blurhash placeholder with every cover', function () {
        $cover = modPhoto($this->vehicle);
        $cover->forceFill(['focal_x' => 0.5, 'focal_y' => 0.38, 'variants' => ['64' => 'media/x/a-64.webp', '320' => 'media/x/a-320.webp']])->save();
        $this->vehicle->forceFill(['cover_media_id' => $cover->id])->save();
        adm32SignedIn('owner');

        $placeholder = fn ($v) => is_string($v) && str_starts_with($v, 'data:image/png;base64,');
        $this->get('/admin/vehicles')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('rows.data.0.cover_focus', '50% 38%')->where('rows.data.0.cover_placeholder', $placeholder)
            ->where('rows.data.0.cover', fn ($v) => str_ends_with((string) $v, 'a-64.webp')));
        $this->get('/admin/vehicles/'.$this->vehicle->id)->assertInertia(fn (AssertableInertia $p) => $p
            ->where('vehicle.cover_focus', '50% 38%')->where('vehicle.cover_placeholder', $placeholder));
        $this->get('/admin/members/'.$this->owner->id.'?tab=vehicles')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('vehicles.0.cover_focus', '50% 38%')->where('vehicles.0.cover_placeholder', $placeholder));
    });

    it('sends the category glyph of every mod', function () {
        Modification::factory()->create(['vehicle_id' => $this->vehicle->id]);
        adm32SignedIn('owner');

        $this->get('/admin/vehicles/'.$this->vehicle->id.'?tab=mods')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('mods.0.category_icon', fn ($v) => is_string($v) && $v !== ''));
    });
});

describe('DQ-541 device names', function () {
    it('names known devices from the member\'s own tokens and browser sessions, never leaking a user agent, IP or fingerprint', function () {
        $member = adm32Member();
        $token = $member->createToken('app');
        $token->accessToken->forceFill(['device_name' => 'Pixel 8', 'platform' => DevicePlatform::Android, 'device_id' => 'install-1234-abcd'])->save();
        $agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
        DB::table('sessions')->insert(['id' => Str::random(40), 'user_id' => $member->id, 'ip_address' => '203.0.113.9', 'user_agent' => $agent, 'payload' => '', 'last_activity' => time()]);
        $app = (new DeviceInfo('Pixel 8', DevicePlatform::Android, null, 'install-1234-abcd'))->fingerprint();
        $browser = KnownDevices::userAgentFingerprint($agent);
        foreach ([$app, $browser, hash('sha256', 'unknown')] as $i => $fingerprint) {
            KnownDevice::query()->create(['user_id' => $member->id, 'fingerprint' => $fingerprint, 'last_seen_at' => now()->subHours($i)]);
        }
        adm32SignedIn('owner');

        $response = $this->get('/admin/members/'.$member->id.'?tab=security')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('security.sign_ins.0.kind', 'app')->where('security.sign_ins.0.name', 'Pixel 8')->where('security.sign_ins.0.platform', 'android')
            ->where('security.sign_ins.1.kind', 'browser')->where('security.sign_ins.1.browser', 'Chrome')->where('security.sign_ins.1.os', 'macOS')
            ->where('security.sign_ins.2.kind', null)->where('security.sign_ins.2.name', null)
            ->missing('security.sign_ins.0.fingerprint'));

        $html = $response->getContent();
        expect($html)->not->toContain('203.0.113.9')->not->toContain('AppleWebKit')->not->toContain($browser)->not->toContain($app);
    });

    it('reads a user agent coarsely', function (string $agent, ?string $browser, ?string $os) {
        expect(DeviceLabel::parse($agent))->toBe(['browser' => $browser, 'os' => $os]);
    })->with([
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 'Safari', 'iPhone'],
        ['Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36', 'Samsung Internet', 'Android'],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0', 'Firefox', 'Windows'],
        ['SpeedClubQA/1.0 (Playwright)', null, null],
    ]);
});
