<?php

use App\Enums\MemberSecurityEvent;
use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Enums\SecurityNotice;
use App\Enums\UserStatus;
use App\Mail\SecurityNoticeMail;
use App\Models\AuditEvent;
use App\Models\Follow;
use App\Models\Media;
use App\Models\Message;
use App\Models\PushToken;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Account\HardDeleteAccount;
use App\Services\Auth\MemberSessions;
use App\Services\Media\MediaService;
use App\Services\PublicPages\OgImages;
use App\Services\Qr\QrCodes;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SettingsTestHelpers.php';
require_once __DIR__.'/../Messaging/MessagingTestHelpers.php';

beforeEach(function () {
    // Symfony's test requests say en-us; the copy checked here is German.
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
    Storage::fake('local');
    Storage::fake('public');
    config(['speedclub.media.private_disk' => 'local']);
});

/**
 * @return array{member: User, vehicle: Vehicle, qr: QrCode, photo: Media, friend: User}
 */
function setClosable(): array
{
    $member = setMember(['username' => 'paul.roadster']);
    $vehicle = Vehicle::factory()->published()->create(['owner_id' => $member->id]);
    $qr = QrCode::factory()->create(['vehicle_id' => $vehicle->id]);
    $photo = Media::factory()->forModel($vehicle)->create(['owner_id' => $member->id]);
    // Where MediaService keeps a photo's files: media/{id}/ on both disks.
    $photo->forceFill(['original_path' => 'media/'.$photo->id.'/original.jpg', 'variants' => ['320' => 'media/'.$photo->id.'/320.webp']])->save();
    Storage::disk('local')->put((string) $photo->getAttribute('original_path'), 'original');
    foreach ((array) $photo->getAttribute('variants') as $path) {
        Storage::disk('public')->put($path, 'variant');
    }
    $friend = setMember(['username' => 'nina.neu']);
    Follow::factory()->create(['follower_id' => $member->id, 'followee_id' => $friend->id]);
    Follow::factory()->create(['follower_id' => $friend->id, 'followee_id' => $member->id]);
    PushToken::factory()->create(['user_id' => $member->id, 'device_id' => 'install-here-0001', 'token' => 'ExponentPushToken[eeeeeeeeeeeeeeeeeeeeee]']);

    return compact('member', 'vehicle', 'qr', 'photo', 'friend');
}

it('closes the account at once and completely (SET-13)', function () {
    ['member' => $member, 'vehicle' => $vehicle, 'qr' => $qr, 'photo' => $photo, 'friend' => $friend] = setClosable();
    $token = setSignIn($member, 'install-here-0001');
    $message = msgStart($friend, $member, 'Hey Paul, schöner Roadster!', chat: false);

    $this->withToken($token)->postJson('/api/v1/me/delete', ['password' => 'password'])->assertNoContent();
    app('auth')->forgetGuards();

    $fresh = $member->fresh();
    expect($fresh->status)->toBe(UserStatus::Deactivated)
        ->and($fresh->isPendingDeletion())->toBeTrue()
        ->and($fresh->tokens()->count())->toBe(0)
        ->and($fresh->pushTokens()->count())->toBe(0)
        ->and(Follow::query()->where('follower_id', $member->id)->orWhere('followee_id', $member->id)->count())->toBe(0)
        ->and($qr->fresh()->status)->toBe(QrStatus::Revoked)
        ->and($qr->fresh()->revoked_reason)->toBe(QrRevocationReason::AccountDeleted)
        ->and($photo->fresh()?->trashed())->toBeTrue()
        ->and(Media::withTrashed()->find($photo->id)?->getAttribute('variants'))->toBeNull()
        ->and(Storage::disk('local')->exists((string) $photo->getAttribute('original_path')))->toBeTrue();

    $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
    $this->getJson('/api/v1/public/users/paul.roadster')->assertNotFound();
    $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug())->assertNotFound();
    $this->getJson('/api/v1/qr/'.$qr->code)->assertOk()->assertJsonPath('data.state', 'revoked');

    // The other side keeps the conversation, with a deleted member.
    msgActAs($friend);
    $this->getJson("/api/v1/conversations/{$message->conversation_id}/messages")->assertOk()->assertJsonCount(1, 'data');

    Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::DeletionRequested && $mail->hasTo($member->email));
    expect(AuditEvent::query()->where('action', MemberSecurityEvent::DeletionRequested->value)->where('target_id', $member->id)->exists())->toBeTrue();
});

it('answers sign-in in the 30 days as for an unknown account', function () {
    ['member' => $member] = setClosable();
    Sanctum::actingAs($member);
    $this->postJson('/api/v1/me/delete', ['password' => 'password'])->assertNoContent();
    app('auth')->forgetGuards();

    $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'password', 'device_name' => 'Pixel 9'])
        ->assertUnauthorized()->assertJsonPath('code', 'invalid_credentials');
    $this->postJson('/api/v1/auth/login', ['email' => $member->email, 'password' => 'falsch-falsch', 'device_name' => 'Pixel 9'])
        ->assertUnauthorized()->assertJsonPath('code', 'invalid_credentials');
});

it('needs the password, and the second factor when two-factor is on', function () {
    $member = setMember();
    [$secret] = setEnableTwoFactor($member);
    Sanctum::actingAs($member);

    $this->postJson('/api/v1/me/delete', ['password' => 'falsch-falsch'])->assertUnprocessable()->assertJsonValidationErrors('password');
    $this->postJson('/api/v1/me/delete', ['password' => 'password'])->assertUnprocessable()->assertJsonValidationErrors('code');
    $this->postJson('/api/v1/me/delete', ['password' => 'password', 'code' => '000000'])->assertUnprocessable()->assertJsonValidationErrors('code');
    expect($member->fresh()->isPendingDeletion())->toBeFalse();

    $this->postJson('/api/v1/me/delete', ['password' => 'password', 'code' => setOtp($secret)])->assertNoContent();
    expect($member->fresh()->isPendingDeletion())->toBeTrue();
});

it('stays open under a restriction (GDPR)', function () {
    $member = User::factory()->suspended()->create();
    Sanctum::actingAs($member);

    $this->postJson('/api/v1/me/delete', ['password' => 'password'])->assertNoContent();
    expect($member->fresh()->isPendingDeletion())->toBeTrue();
});

it('hard-deletes after the days, keeps the messages with a null sender and the QR tombstone', function () {
    ['member' => $member, 'vehicle' => $vehicle, 'qr' => $qr, 'photo' => $photo, 'friend' => $friend] = setClosable();
    $message = msgStart($member, $friend, 'Bis Samstag am Nürburgring!', chat: false);
    Sanctum::actingAs($member);
    $this->postJson('/api/v1/me/delete', ['password' => 'password'])->assertNoContent();
    app('auth')->forgetGuards();

    $this->artisan('accounts:prune')->assertSuccessful();
    expect(User::withTrashed()->find($member->id))->not->toBeNull();

    $this->travel(30)->days();
    $this->artisan('accounts:prune')->assertSuccessful();

    expect(User::withTrashed()->find($member->id))->toBeNull()
        ->and(Vehicle::withTrashed()->find($vehicle->id))->toBeNull()
        ->and(Media::withTrashed()->find($photo->id))->toBeNull()
        ->and(Storage::disk('local')->exists((string) $photo->getAttribute('original_path')))->toBeFalse()
        ->and($qr->fresh())->not->toBeNull()
        ->and($qr->fresh()?->vehicle_id)->toBeNull()
        ->and(Message::query()->find($message->id)?->sender_id)->toBeNull()
        ->and(AuditEvent::query()->where('action', MemberSecurityEvent::HardDeleted->value)->where('target_id', $member->id)->exists())->toBeTrue();

    msgActAs($friend);
    $this->getJson("/api/v1/conversations/{$message->conversation_id}/messages")->assertOk()->assertJsonCount(1, 'data');
});

it('frees the address for a new registration after the hard delete', function () {
    $member = setMember(['email' => 'paul@example.de']);
    Sanctum::actingAs($member);
    $this->postJson('/api/v1/me/delete', ['password' => 'password'])->assertNoContent();
    app('auth')->forgetGuards();

    $this->travel(30)->days();
    $this->artisan('accounts:prune')->assertSuccessful();

    expect(User::withTrashed()->where('email', 'paul@example.de')->exists())->toBeFalse();
});

it('never hard-deletes an account that did not ask, or asked too recently', function () {
    $staffClosed = User::factory()->deactivated()->create();
    $recent = setMember();
    $recent->forceFill(['status' => UserStatus::Deactivated, 'deletion_requested_at' => now()->subDays(10)])->save();

    (new HardDeleteAccount($staffClosed->id))->handle(app(MediaService::class), app(QrCodes::class), app(MemberSessions::class), app(OgImages::class));
    $this->artisan('accounts:prune')->assertSuccessful();

    expect($staffClosed->fresh())->not->toBeNull()->and($recent->fresh())->not->toBeNull();
});

describe('WEB-05 /konto-loeschen', function () {
    it('explains the consequences without a session and links from the footer', function () {
        $response = $this->get('/konto-loeschen')->assertOk()
            ->assertSee('Was beim Löschen passiert')
            ->assertSee('Gelöschtes Mitglied')
            ->assertSee('name="robots" content="noindex"', false)
            ->assertSee('data-testid="WEB-05.form"', false);

        expect($response->headers->getCookies())->toBe([]);
        $this->get('/impressum')->assertSee('WEB.footer.delete_account', false)->assertSee('/konto-loeschen', false)->assertSee('/kontakt', false);
    });

    it('deletes with e-mail, password and the confirmation box', function () {
        ['member' => $member] = setClosable();

        $this->post('/konto-loeschen', ['email' => strtoupper($member->email), 'password' => 'password', 'confirm' => '1'])
            ->assertOk()->assertSee(__('public.account_deletion.done_title', [], 'de'));

        expect($member->fresh()->isPendingDeletion())->toBeTrue();
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === SecurityNotice::DeletionRequested);
    });

    it('answers a wrong password and an unknown address the same', function () {
        $member = setMember();

        $wrong = $this->post('/konto-loeschen', ['email' => $member->email, 'password' => 'falsch-falsch', 'confirm' => '1'])->assertUnprocessable();
        $unknown = $this->post('/konto-loeschen', ['email' => 'niemand@example.de', 'password' => 'falsch-falsch', 'confirm' => '1'])->assertUnprocessable();

        $wrong->assertSee("E-\u{2060}Mail-Adresse oder Passwort stimmen nicht.");
        $unknown->assertSee("E-\u{2060}Mail-Adresse oder Passwort stimmen nicht.");
        expect($member->fresh()->isPendingDeletion())->toBeFalse();
    });

    it('asks for the confirmation and the second factor', function () {
        $member = setMember();
        [$secret] = setEnableTwoFactor($member);

        $this->post('/konto-loeschen', ['email' => $member->email, 'password' => 'password'])->assertUnprocessable()->assertSee('endgültig löschen willst');
        $this->post('/konto-loeschen', ['email' => $member->email, 'password' => 'password', 'confirm' => '1'])->assertUnprocessable()->assertSee('Authenticator-App');
        expect($member->fresh()->isPendingDeletion())->toBeFalse();

        $this->post('/konto-loeschen', ['email' => $member->email, 'password' => 'password', 'confirm' => '1', 'code' => setOtp($secret)])->assertOk();
        expect($member->fresh()->isPendingDeletion())->toBeTrue();
    });

    it('refuses a cross-site post', function () {
        $member = setMember();

        $this->withHeader('Sec-Fetch-Site', 'cross-site')
            ->post('/konto-loeschen', ['email' => $member->email, 'password' => 'password', 'confirm' => '1'])
            ->assertUnprocessable();
        expect($member->fresh()->isPendingDeletion())->toBeFalse();
    });

    it('limits failures per account and per IP', function () {
        $member = setMember();

        for ($i = 0; $i < 5; $i++) {
            $this->post('/konto-loeschen', ['email' => $member->email, 'password' => 'falsch-falsch', 'confirm' => '1'])->assertUnprocessable();
        }

        $this->post('/konto-loeschen', ['email' => $member->email, 'password' => 'password', 'confirm' => '1'])->assertStatus(429);
        expect($member->fresh()->isPendingDeletion())->toBeFalse();

        for ($i = 0; $i < 4; $i++) {
            $this->post('/konto-loeschen', ['email' => 'x'.$i.'@example.de', 'password' => 'falsch-falsch', 'confirm' => '1']);
        }

        $this->post('/konto-loeschen', ['email' => 'y@example.de', 'password' => 'falsch-falsch', 'confirm' => '1'])->assertStatus(429);
    });

    it('checks Turnstile when configured', function () {
        config(['speedclub.services.turnstile_site_key' => 'site-key', 'speedclub.services.turnstile_secret' => 'secret']);
        Http::preventStrayRequests();
        Http::fake(['challenges.cloudflare.com/*' => Http::response(['success' => false])]);
        $member = setMember();

        $this->get('/konto-loeschen')->assertSee('cf-turnstile', false);
        $this->post('/konto-loeschen', ['email' => $member->email, 'password' => 'password', 'confirm' => '1', 'cf-turnstile-response' => 'token'])
            ->assertUnprocessable()->assertSee('Sicherheitsprüfung');
        expect($member->fresh()->isPendingDeletion())->toBeFalse();
    });
});
