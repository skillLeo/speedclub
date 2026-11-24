<?php

use App\Enums\BadgeMetric;
use App\Enums\NotificationType;
use App\Enums\RestrictionType;
use App\Enums\SocialProvider;
use App\Mail\PasswordResetCodeMail;
use App\Mail\VerificationCodeMail;
use App\Models\AuditEvent;
use App\Models\InviteCode;
use App\Models\Notification;
use App\Models\User;
use App\Models\UserBadge;
use App\Models\XpEvent;
use App\Services\Badges\BadgeMetrics;
use App\Services\Invites\InviteCodes;
use App\Services\Members\FoundingNumbers;
use App\Services\Members\MemberActivation;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Tests\Support\FakeIdTokens;

require_once __DIR__.'/GiftTestHelpers.php';
require_once __DIR__.'/../Auth20/Helpers.php';
require_once __DIR__.'/../Admin/Support/helpers.php';

/**
 * M5.9d activation (m5.9d contract §4, §5, §9, §10.4): the Founding Member number at the real activation moment (production only, never
 * samples, editorial, demo or test addresses, never re-used, stops at 1000), invite codes on the four account-creating calls (an
 * invalid code ignored, never 422), redemption at activation with "Crew Starter" for both sides and nothing else, GET me/invites,
 * GET invites/{code}, the /join/{code} page and the app-link paths.
 */
const GIFT_PASSWORD = 'Lackierung-92-rot';

function giftRegister(string $email, array $extra = []): void
{
    test()->postJson('/api/v1/auth/register', ['email' => $email, 'password' => GIFT_PASSWORD, 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true, ...$extra])->assertStatus(202);
}

function giftVerify(string $email, array $extra = []): User
{
    $code = Mail::sent(VerificationCodeMail::class, fn (VerificationCodeMail $mail): bool => $mail->hasTo($email))->last()->code;
    test()->postJson('/api/v1/auth/email/verify', ['email' => $email, 'code' => $code, 'password' => GIFT_PASSWORD, 'device_name' => 'Pixel 9', ...$extra])->assertOk();

    return User::query()->where('email', $email)->firstOrFail();
}

function giftInviter(array $attributes = []): array
{
    $inviter = giftMember(['email' => 'inviter-'.Str::lower(Str::random(6)).'@garage.test', 'username' => 'crewlead'.Str::lower(Str::random(4)), ...$attributes]);
    $codes = app(InviteCodes::class)->for($inviter);

    return [$inviter, (string) $codes->first()->code];
}

beforeEach(function () {
    Mail::fake();
    Cache::flush();
    giftBadges();
    config(['speedclub.founding.environments' => ['testing'], 'speedclub.email_code.min_response_ms' => 0]);
});

describe('Founding Member numbers', function () {
    it('numbers members at activation (registration verified), in order, once', function () {
        giftRegister('erste@garage.test');
        giftRegister('zweite@garage.test');
        $first = giftVerify('erste@garage.test');
        $second = giftVerify('zweite@garage.test');

        expect($first->founding_number)->toBe(1)->and($second->founding_number)->toBe(2)
            ->and($first->activated_at)->not->toBeNull()
            ->and(UserBadge::query()->where('user_id', $first->id)->where('badge_key', 'founding-member')->exists())->toBeTrue()
            ->and(AuditEvent::query()->where('action', 'founding.assigned')->where('target_id', $first->id)->value('after'))->toBe(['founding_number' => 1]);

        app(MemberActivation::class)->activate($first->fresh());
        expect($first->fresh()->founding_number)->toBe(1)->and(AuditEvent::query()->where('action', 'founding.assigned')->count())->toBe(2);
    });

    it('numbers a passwordless account when it accepts the terms, not before', function () {
        [$user, $token] = a20Passwordless('ohne@garage.test', pendingTerms: true);
        expect($user->fresh()->founding_number)->toBeNull();

        $this->withToken($token)->postJson('/api/v1/me/onboarding/accept', ['terms_version' => '1', 'privacy_version' => '1', 'age_confirmed' => true])->assertOk()
            ->assertJsonPath('data.founding_number', 1);
    });

    it('never numbers outside the configured environments, samples, editorial or demo/test addresses', function (array $attributes, array $config) {
        config($config);
        $user = User::factory()->create(['email' => 'mitglied@garage.test', ...$attributes]);
        app(MemberActivation::class)->activate($user);

        expect($user->fresh()->founding_number)->toBeNull()->and($user->fresh()->activated_at)->not->toBeNull();
    })->with([
        'staging/testing' => [[], ['speedclub.founding.environments' => ['production']]],
        'sample' => [['is_sample' => true], []],
        'editorial' => [['is_editorial' => true], []],
        'demo address' => [['email' => 'lena@speedclub.test'], []],
        'example address' => [['email' => 'lena@example.com'], []],
    ]);

    it('runs only in production by default', function () {
        expect(config('speedclub.founding.environments'))->toBe(['testing']);
        config(['speedclub.founding.environments' => ['production']]);
        $user = User::factory()->create(['email' => 'p@garage.test']);

        expect(FoundingNumbers::eligible($user))->toBeFalse();
        $this->app->detectEnvironment(fn (): string => 'production');
        expect(FoundingNumbers::eligible($user))->toBeTrue();
    });

    it('never re-uses a number, not after a deleted account, and stops at 1000', function () {
        $first = User::factory()->create(['email' => 'a@garage.test']);
        app(MemberActivation::class)->activate($first);
        $first->forceDelete();

        $second = User::factory()->create(['email' => 'b@garage.test']);
        app(MemberActivation::class)->activate($second);
        expect($second->fresh()->founding_number)->toBe(2);

        DB::table('sequence_counters')->where('key', FoundingNumbers::COUNTER)->update(['value' => 999]);
        $last = User::factory()->create(['email' => 'c@garage.test']);
        $late = User::factory()->create(['email' => 'd@garage.test']);
        app(MemberActivation::class)->activate($last);
        app(MemberActivation::class)->activate($late);

        expect($last->fresh()->founding_number)->toBe(1000)->and($late->fresh()->founding_number)->toBeNull()
            ->and((int) DB::table('sequence_counters')->where('key', FoundingNumbers::COUNTER)->value('value'))->toBe(1000);
    });

    it('activates members who were active before the migration only once (activated_at backfilled), never for a new code', function () {
        [, $code] = giftInviter();
        $member = giftMember(['email' => 'alt@garage.test', 'activated_at' => now()->subYear()]);

        app(MemberActivation::class)->noteInvite($member, $code);
        app(MemberActivation::class)->activate($member);

        expect($member->fresh()->founding_number)->toBeNull()->and(InviteCode::query()->whereKey($code)->value('accepted_by'))->toBeNull();
    });
});

describe('invite codes at sign-up', function () {
    it('redeems the code of a registration at activation: Crew Starter for both, an invite_accepted row, nothing else', function () {
        [$inviter, $code] = giftInviter();
        giftRegister('neu@garage.test', ['invite_code' => strtolower($code)]);
        expect(InviteCode::query()->whereKey($code)->value('accepted_by'))->toBeNull();

        $invitee = giftVerify('neu@garage.test');

        expect(InviteCode::query()->findOrFail($code)->accepted_by)->toBe($invitee->id)
            ->and(UserBadge::query()->where('badge_key', 'crew-starter')->pluck('user_id')->sort()->values()->all())->toBe(collect([$inviter->id, $invitee->id])->sort()->values()->all())
            ->and(Notification::query()->where('notifiable_id', $inviter->id)->where('type', NotificationType::InviteAccepted->value)->value('data'))->toBe(['code' => $code])
            ->and(XpEvent::query()->count())->toBe(0)
            ->and($inviter->fresh()->xp)->toBe(0)
            ->and($invitee->pending_invite_code)->toBeNull();
    });

    it('keeps a code redeemed after the invitee\'s account is hard-deleted: nobody can redeem it again (CR-P5G-10 / SEC-P5G-06)', function () {
        [$inviter, $code] = giftInviter();
        giftRegister('erst@garage.test', ['invite_code' => $code]);
        $first = giftVerify('erst@garage.test');
        expect(InviteCode::query()->findOrFail($code)->accepted_by)->toBe($first->id);

        $first->forceDelete();
        $invite = InviteCode::query()->findOrFail($code);
        expect($invite->accepted_by)->toBeNull()->and($invite->accepted_at)->not->toBeNull();

        $this->getJson('/api/v1/invites/'.$code)->assertNotFound();
        giftRegister('zweit@garage.test', ['invite_code' => $code]);
        $second = giftVerify('zweit@garage.test');

        expect(InviteCode::query()->findOrFail($code)->accepted_by)->toBeNull()
            ->and(UserBadge::query()->where('badge_key', 'crew-starter')->where('user_id', $second->id)->exists())->toBeFalse()
            ->and(app(BadgeMetrics::class)->values(BadgeMetric::InvitesAccepted, null, [$inviter->id]))->toBe([$inviter->id => 1]);
    });

    it('takes the code on the passwordless verify and redeems it when the terms are accepted', function () {
        [, $code] = giftInviter();
        [$attempt, $mailed] = a20Start('pw@garage.test');
        $token = $this->postJson('/api/v1/auth/email/verify', ['email' => 'pw@garage.test', 'attempt_id' => $attempt, 'code' => $mailed, 'invite_code' => $code, ...a20Device()])->assertOk()->json('data.token');

        expect(InviteCode::query()->whereKey($code)->value('accepted_by'))->toBeNull();
        $this->withToken($token)->postJson('/api/v1/me/onboarding/accept', ['terms_version' => '1', 'privacy_version' => '1', 'age_confirmed' => true])->assertOk();

        expect(InviteCode::query()->whereKey($code)->value('accepted_by'))->toBe(User::query()->where('email', 'pw@garage.test')->value('id'));
    });

    it('takes the code on Apple and Google sign-ups', function (string $provider) {
        FakeIdTokens::install(['test-kid']);
        a20Flag('auth.apple');
        a20Flag('auth.google');
        [, $code] = giftInviter();
        $body = $provider === 'apple'
            ? ['identity_token' => FakeIdTokens::apple(FakeIdTokens::serverNonce(SocialProvider::Apple)), 'raw_nonce' => FakeIdTokens::$lastNonce]
            : FakeIdTokens::googleInput();
        $token = $this->postJson("/api/v1/auth/$provider", [...$body, ...a20Device(), 'invite_code' => $code])->assertOk()->json('data.token');
        $this->withToken($token)->postJson('/api/v1/me/onboarding/accept', ['terms_version' => '1', 'privacy_version' => '1', 'age_confirmed' => true])->assertOk();

        expect(InviteCode::query()->whereKey($code)->value('accepted_by'))->toBe(User::query()->where('email', 'lena@beispiel.test')->value('id'));
    })->with(['apple', 'google']);

    it('ignores an invalid code on every account-creating call, never a 422', function (mixed $code) {
        giftRegister('frei@garage.test', ['invite_code' => $code]);
        giftVerify('frei@garage.test', ['invite_code' => $code]);
        [$attempt, $mailed] = a20Start('frei2@garage.test');
        $this->postJson('/api/v1/auth/email/verify', ['email' => 'frei2@garage.test', 'attempt_id' => $attempt, 'code' => $mailed, 'invite_code' => $code, ...a20Device()])->assertOk();

        expect(InviteCode::query()->whereNotNull('accepted_by')->count())->toBe(0);
    })->with([
        'unknown' => ['ZZZZZZZZ'],
        'too short' => ['ABC'],
        'array' => [['ABCDEFGH']],
        'number' => [12345678],
        'very long' => [str_repeat('A', 500)],
        'null' => [null],
    ]);

    it('refuses reuse: a redeemed code works once', function () {
        [, $code] = giftInviter();
        giftRegister('eins@garage.test', ['invite_code' => $code]);
        giftRegister('zwei@garage.test', ['invite_code' => $code]);
        $first = giftVerify('eins@garage.test');
        $second = giftVerify('zwei@garage.test');

        expect(InviteCode::query()->findOrFail($code)->accepted_by)->toBe($first->id)
            ->and(UserBadge::query()->where('user_id', $second->id)->where('badge_key', 'crew-starter')->exists())->toBeFalse();
    });

    it('refuses a member\'s own code and a dead inviter\'s codes', function () {
        [$inviter, $code] = giftInviter();
        expect(app(InviteCodes::class)->redeem($inviter, $code))->toBeNull();

        $inviter->delete();
        giftRegister('spaet@garage.test', ['invite_code' => $code]);
        giftVerify('spaet@garage.test');

        expect(InviteCode::query()->findOrFail($code)->accepted_by)->toBeNull();
        $this->getJson("/api/v1/invites/$code")->assertNotFound();
    });

    it('drops a code a stranger set before the owner proved the address', function () {
        [, $code] = giftInviter();
        giftRegister('fremd@garage.test', ['invite_code' => $code]);
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'fremd@garage.test'])->assertStatus(202);
        $reset = Mail::sent(PasswordResetCodeMail::class)->last()->code;
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'fremd@garage.test', 'code' => $reset, 'password' => 'Neues-Passwort-77'])->assertOk();

        expect(InviteCode::query()->findOrFail($code)->accepted_by)->toBeNull()
            ->and(User::query()->where('email', 'fremd@garage.test')->value('activated_at'))->not->toBeNull();
    });
});

describe('GET me/invites', function () {
    it('creates five codes on the first read and keeps them, with the redeemer while visible', function () {
        [$inviter] = giftInviter();
        Sanctum::actingAs($inviter);

        $first = $this->getJson('/api/v1/me/invites')->assertOk()->json('data');
        $again = $this->getJson('/api/v1/me/invites')->assertOk()->json('data');

        expect($first)->toHaveCount(5)->and($again)->toBe($first)
            ->and(collect($first)->every(fn (array $i): bool => preg_match(InviteCodes::PATTERN, $i['code']) === 1 && $i['accepted_at'] === null && $i['accepted_by'] === null))->toBeTrue();

        $invitee = giftMember(['username' => 'neuling', 'display_name' => 'Neu Ling']);
        InviteCode::query()->whereKey($first[0]['code'])->update(['accepted_by' => $invitee->id, 'accepted_at' => now()]);
        $read = $this->getJson('/api/v1/me/invites')->json('data');

        expect($read[0]['accepted_by'])->toBe(['username' => 'neuling', 'display_name' => 'Neu Ling'])->and($read)->toHaveCount(5);

        giftBlock($invitee, $inviter);
        expect($this->getJson('/api/v1/me/invites')->json('data.0.accepted_by'))->toBeNull()
            ->and($this->getJson('/api/v1/me/invites')->json('data.0.accepted_at'))->not->toBeNull();
    });

    it('is for members others may see', function (Closure $who, int $status) {
        $viewer = $who();
        $viewer instanceof User ? Sanctum::actingAs($viewer) : ($viewer !== null ? actingAsStaff($viewer) : null);

        $this->getJson('/api/v1/me/invites')->assertStatus($status);
    })->with([
        'guest' => [fn () => null, 401],
        'member' => [fn () => giftMember(), 200],
        'restricted member' => [fn () => giftMember(['restrictions' => [RestrictionType::Publishing->value => ['until' => null]]]), 200],
        'member without a username' => [fn () => giftMember(['username' => null]), 403],
        // M5.9f: the staging showcase account sees its seeded codes (they never work, see GET invites/{code}).
        'sample member off production' => [fn () => giftMember(['is_sample' => true]), 200],
        'unverified member' => [fn () => User::factory()->unverified()->create(), 403],
        'staff' => [function () {
            seedStaffRoles();

            return staffWithRole('admin');
        }, 401],
    ]);
});

it('keeps the invite list closed to sample accounts in production', function () {
    Sanctum::actingAs(giftMember(['is_sample' => true]));
    app()->detectEnvironment(fn () => 'production');

    $this->getJson('/api/v1/me/invites')->assertForbidden();
});

describe('GET invites/{code}', function () {
    it('names the inviter of an open code, read case-insensitively with the Crockford look-alikes', function () {
        [$inviter] = giftInviter(['display_name' => 'Crew Lead']);
        InviteCode::query()->where('inviter_id', $inviter->id)->delete();
        InviteCode::factory()->create(['code' => '10ABCDEF', 'inviter_id' => $inviter->id]);

        $this->getJson('/api/v1/invites/lOabcdef')->assertOk()
            ->assertExactJson(['data' => ['code' => '10ABCDEF', 'inviter' => ['username' => $inviter->username, 'display_name' => 'Crew Lead']]]);
    });

    it('answers 404 for unknown, used and dead codes', function (Closure $code) {
        $this->getJson('/api/v1/invites/'.$code())->assertNotFound()->assertJsonPath('code', 'not_found');
    })->with([
        'unknown' => [fn () => 'ZZZZZZZZ'],
        'malformed' => [fn () => 'x'],
        'used' => [fn () => InviteCode::factory()->create(['accepted_by' => giftMember()->id, 'accepted_at' => now()])->code],
        'used by an account deleted since (CR-P5G-10)' => [fn () => InviteCode::factory()->create(['accepted_by' => null, 'accepted_at' => now()->subWeek()])->code],
        'suspended inviter' => [fn () => InviteCode::factory()->create(['inviter_id' => User::factory()->suspended()->create()->id])->code],
    ]);

    it('is limited per IP', function () {
        foreach (range(1, config()->integer('speedclub.rate_limits.invite_lookup.max')) as $i) {
            $this->getJson('/api/v1/invites/ZZZZZZZZ')->assertNotFound();
        }

        $this->getJson('/api/v1/invites/ZZZZZZZZ')->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });
});

describe('codes of a sample inviter (lead decision, crawl triage M5.9f)', function () {
    it('work outside production like a real member\'s: lookup, /join and redemption, Crew Starter for the invitee', function (string $environment) {
        app()->detectEnvironment(fn () => $environment);
        [$inviter, $code] = giftInviter(['is_sample' => true, 'display_name' => 'Sebastian']);

        $this->getJson('/api/v1/invites/'.$code)->assertOk()->assertJsonPath('data.inviter.username', $inviter->username);
        $this->get('/join/'.$code)->assertOk()->assertSee('data-state="valid"', false);

        giftRegister('gast@garage.test', ['invite_code' => $code]);
        $invitee = giftVerify('gast@garage.test');

        expect(InviteCode::query()->findOrFail($code)->accepted_by)->toBe($invitee->id)
            ->and(UserBadge::query()->where('user_id', $invitee->id)->where('badge_key', 'crew-starter')->exists())->toBeTrue()
            // A sample account earns nothing through the hooks (BadgeAwarder::eligible); the demo seeder hands the showcase its badges.
            ->and(UserBadge::query()->where('user_id', $inviter->id)->exists())->toBeFalse();
    })->with(['local', 'staging']);

    it('never work in production: no lookup, no /join, no redemption', function () {
        [$inviter, $code] = giftInviter(['is_sample' => true]);
        app()->detectEnvironment(fn () => 'production');

        $this->getJson('/api/v1/invites/'.$code)->assertNotFound()->assertJsonPath('code', 'not_found');
        $this->get('/join/'.$code)->assertNotFound()->assertSee('data-state="invalid"', false);

        expect(InviteCodes::mayInvite($inviter))->toBeFalse()
            ->and(app(InviteCodes::class)->redeem(giftMember(), $code))->toBeNull()
            ->and(InviteCode::query()->findOrFail($code)->accepted_by)->toBeNull();
    });
});

describe('the /join/{code} page', function () {
    it('names who invites and hands the code to the member web sign-up', function () {
        [$inviter, $code] = giftInviter(['display_name' => 'Crew Lead']);

        $response = $this->withHeader('Accept-Language', 'de')->get('/join/'.strtolower($code))->assertOk()
            ->assertSee('Crew Lead lädt dich zu Speedclub ein')
            ->assertSee('/app/join/'.$code, false)
            ->assertSee('data-state="valid"', false);

        expect($response->headers->get('X-Robots-Tag'))->toBe('noindex')
            ->and($response->headers->get('Cache-Control'))->toContain('no-store')
            ->and($response->headers->getCookies())->toBe([]);
    });

    it('answers 404 with a way to sign up for an invalid code', function () {
        $this->get('/join/ZZZZZZZZ')->assertNotFound()->assertSee('data-state="invalid"', false)->assertSee('/app/sign-up', false);
    });

    it('is an app-link path of both platforms and shared for link previews, never indexed', function () {
        config(['speedclub.mobile.ios_team_id' => 'TEAM123456', 'speedclub.mobile.ios_bundle_id' => 'de.speedclub.app', 'speedclub.public_pages.allow_indexing' => true]);

        $components = collect($this->getJson('/.well-known/apple-app-site-association')->json('applinks.details.0.components'))->pluck('/')->all();
        $robots = (string) $this->get('/robots.txt')->getContent();

        expect($components)->toContain('/join/*')
            ->and($robots)->toContain('Allow: /join/')
            ->and($robots)->toContain('Disallow: /join/');
    });
});
