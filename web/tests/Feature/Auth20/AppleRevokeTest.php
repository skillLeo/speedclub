<?php

use App\Actions\Auth\ClearUnprovenAccountData;
use App\Actions\Security\SecureAccount;
use App\Enums\MemberSecurityEvent;
use App\Enums\SocialProvider;
use App\Models\AuditEvent;
use App\Models\SecurityEvent;
use App\Models\SocialAccount;
use App\Models\User;
use App\Services\Auth\IdTokens\AppleTokens;
use App\Services\Auth\IdTokens\IdTokenVerifier;
use App\Services\Auth\IdTokens\SocialAccounts;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Tests\Support\FakeIdTokens;

require_once __DIR__.'/Helpers.php';

/**
 * M4.18 (09 §8.1, ADR-435 carry-over): every way an Apple link goes revokes its refresh token at Apple the same way account deletion
 * does, after the response, audited as `member.apple_revoked`: unlinking in SET-19, "Das war ich nicht" removing a link added since
 * the reported sign-in, and clearing an unproven account. A Google link is never sent to Apple.
 */
beforeEach(function () {
    Mail::fake();
    config(['speedclub.email_code.min_response_ms' => 0]);
    FakeIdTokens::install();
    a20Flag('auth.google');
    a20Flag('auth.apple');

    // A .p8 key of our own (P-256), so AppleTokens is configured and really calls the (faked) revoke endpoint.
    $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
    openssl_pkey_export($key, $pem);
    $this->p8 = storage_path('framework/testing/apple-'.Str::lower(Str::random(10)).'.p8');
    @mkdir(dirname($this->p8), 0775, true);
    file_put_contents($this->p8, $pem);
    config(['services.apple.team_id' => 'TEAM123456', 'services.apple.key_id' => 'KEY1234567', 'services.apple.private_key_path' => $this->p8]);

    $this->revoked = [];
    Http::fake(['appleid.apple.com/auth/revoke' => function (HttpRequest $request) {
        $this->revoked[] = $request['token'];

        return Http::response('', 200);
    }]);
});

afterEach(fn () => @unlink($this->p8));

/** @return list<string> the outcomes of `member.apple_revoked` for $user */
function appleRevokeOutcomes(User $user): array
{
    return AuditEvent::query()->where('action', MemberSecurityEvent::AppleRevoked->value)->where('target_id', (string) $user->id)
        ->get()->map(fn (AuditEvent $event): string => (string) ($event->after['outcome'] ?? ''))->values()->all();
}

it('revokes the token at Apple when the member unlinks Apple, after the response, and audits it', function () {
    $user = User::factory()->create(['email' => 'lena@beispiel.test']);
    SocialAccount::factory()->apple()->create(['user_id' => $user->id, 'refresh_token_encrypted' => 'apple-refresh-unlink']);
    $token = a20OldToken($user);
    $user->tokens()->update(['reauthenticated_at' => now()]);

    $this->withToken($token)->deleteJson('/api/v1/me/providers/apple')->assertNoContent();

    expect(SocialAccount::query()->where('user_id', $user->id)->exists())->toBeFalse()
        ->and($this->revoked)->toBe(['apple-refresh-unlink'])
        ->and(appleRevokeOutcomes($user))->toBe(['accepted'])
        ->and(AuditEvent::query()->where('action', MemberSecurityEvent::ProviderUnlinked->value)->exists())->toBeTrue();
});

it('never sends a Google link to Apple', function () {
    $user = User::factory()->create(['email' => 'lena@beispiel.test']);
    SocialAccount::factory()->create(['user_id' => $user->id]);
    $token = a20OldToken($user);
    $user->tokens()->update(['reauthenticated_at' => now()]);

    $this->withToken($token)->deleteJson('/api/v1/me/providers/google')->assertNoContent();

    expect($this->revoked)->toBe([])->and(appleRevokeOutcomes($user))->toBe([]);
});

it('records a skipped revoke without the key, as account deletion does', function () {
    config(['services.apple.private_key_path' => null]);
    $user = User::factory()->create(['email' => 'lena@beispiel.test']);
    SocialAccount::factory()->apple()->create(['user_id' => $user->id, 'refresh_token_encrypted' => 'apple-refresh-nokey']);
    $token = a20OldToken($user);
    $user->tokens()->update(['reauthenticated_at' => now()]);

    $this->withToken($token)->deleteJson('/api/v1/me/providers/apple')->assertNoContent();

    expect($this->revoked)->toBe([])->and(appleRevokeOutcomes($user))->toBe(['skipped']);
});

it('still revokes at account deletion', function () {
    [$user, $token] = a20Passwordless();
    SocialAccount::factory()->apple()->create(['user_id' => $user->id, 'refresh_token_encrypted' => 'apple-refresh-delete']);

    $this->withToken($token)->postJson('/api/v1/me/delete', [])->assertNoContent();

    expect($this->revoked)->toBe(['apple-refresh-delete'])->and(appleRevokeOutcomes($user))->toBe(['accepted']);
});

it('revokes an Apple link that "Das war ich nicht" removes', function () {
    $this->withoutDefer();
    $user = User::factory()->create();
    $earlier = SocialAccount::factory()->create(['user_id' => $user->id, 'created_at' => now()->subDays(30)]);
    $reported = SecurityEvent::factory()->create(['user_id' => $user->id, 'type' => MemberSecurityEvent::LoginNewDevice, 'created_at' => now()->subHour()]);
    SocialAccount::factory()->apple()->create(['user_id' => $user->id, 'refresh_token_encrypted' => 'apple-refresh-intruder']);

    app(SecureAccount::class)->handle($user, $reported, 'app');

    expect(SocialAccount::query()->where('user_id', $user->id)->pluck('id')->all())->toBe([$earlier->id])
        ->and($this->revoked)->toBe(['apple-refresh-intruder'])
        ->and(appleRevokeOutcomes($user))->toBe(['accepted']);
});

it('keeps and never revokes an Apple link from before the reported sign-in', function () {
    $this->withoutDefer();
    $user = User::factory()->create();
    $earlier = SocialAccount::factory()->apple()->create(['user_id' => $user->id, 'refresh_token_encrypted' => 'apple-refresh-own', 'created_at' => now()->subDays(30)]);
    $reported = SecurityEvent::factory()->create(['user_id' => $user->id, 'type' => MemberSecurityEvent::LoginNewDevice, 'created_at' => now()->subHour()]);
    SocialAccount::factory()->create(['user_id' => $user->id]);

    app(SecureAccount::class)->handle($user, $reported, 'app');

    expect(SocialAccount::query()->where('user_id', $user->id)->pluck('id')->all())->toBe([$earlier->id])
        ->and($this->revoked)->toBe([])
        ->and(appleRevokeOutcomes($user))->toBe([]);
});

it('revokes the Apple link of an unproven account it clears', function () {
    $this->withoutDefer();
    $user = User::factory()->unverified()->create();
    SocialAccount::factory()->apple()->create(['user_id' => $user->id, 'refresh_token_encrypted' => 'apple-refresh-stranger']);

    app(ClearUnprovenAccountData::class)->handle($user);

    expect(SocialAccount::query()->where('user_id', $user->id)->exists())->toBeFalse()
        ->and($this->revoked)->toBe(['apple-refresh-stranger'])
        ->and(appleRevokeOutcomes($user))->toBe(['accepted']);
});

/**
 * SEC-P4-03 (Low): APPLE_CLIENT_IDS holds the app's bundle ID and the web's Services ID, and Apple revokes a refresh token only with
 * the client_id it was issued to. The link stores the ID token's `aud` and the revoke uses it (form field and client secret `sub`).
 */
describe('SEC-P4-03 revokes with the client the token was issued to', function () {
    beforeEach(function () {
        $this->revokeClients = [];
        $this->revokeSecretSubjects = [];
        Http::fake([
            'appleid.apple.com/auth/token' => fn (HttpRequest $request) => Http::response(['refresh_token' => 'apple-refresh-'.$request['client_id']]),
            'appleid.apple.com/auth/revoke' => function (HttpRequest $request) {
                $this->revokeClients[] = $request['client_id'];
                $this->revokeSecretSubjects[] = json_decode((string) base64_decode(strtr(explode('.', (string) $request['client_secret'])[1], '-_', '+/')), true)['sub'] ?? null;

                return Http::response('', 200);
            },
        ]);
    });

    it('stores the issuing client at linking and revokes with it, also for the second client', function (string $audience) {
        $user = User::factory()->create(['email' => 'lena@beispiel.test']);
        $identity = app(IdTokenVerifier::class)->verify(SocialProvider::Apple, FakeIdTokens::apple(FakeIdTokens::serverNonce(SocialProvider::Apple), ['aud' => $audience]), FakeIdTokens::$lastNonce);

        $account = app(SocialAccounts::class)->link($user, $identity, false, 'apple-authorization-code');

        expect($account->fresh()?->client_id)->toBe($audience)
            ->and($account->fresh()?->getAttribute('refresh_token_encrypted'))->toBe('apple-refresh-'.$audience)
            ->and(app(AppleTokens::class)->revoke($account->fresh()))->toBe('accepted')
            ->and($this->revokeClients)->toBe([$audience])
            ->and($this->revokeSecretSubjects)->toBe([$audience]);
    })->with(['the app (bundle ID)' => ['de.speedclub.app'], 'the web (Services ID)' => ['de.speedclub.web']]);

    it('revokes the web client\'s link with the web client when the member unlinks it', function () {
        $user = User::factory()->create(['email' => 'lena@beispiel.test']);
        SocialAccount::factory()->apple()->create(['user_id' => $user->id, 'client_id' => 'de.speedclub.web', 'refresh_token_encrypted' => 'apple-refresh-web']);
        $token = a20OldToken($user);
        $user->tokens()->update(['reauthenticated_at' => now()]);

        $this->withToken($token)->deleteJson('/api/v1/me/providers/apple')->assertNoContent();

        expect($this->revokeClients)->toBe(['de.speedclub.web'])
            ->and(appleRevokeOutcomes($user))->toBe(['accepted']);
    });

    it('falls back to the first configured client for a link stored before the client was', function () {
        $account = SocialAccount::factory()->apple()->create(['client_id' => null, 'refresh_token_encrypted' => 'apple-refresh-legacy']);

        expect(app(AppleTokens::class)->revoke($account))->toBe('accepted')
            ->and($this->revokeClients)->toBe(['de.speedclub.app']);
    });
});
