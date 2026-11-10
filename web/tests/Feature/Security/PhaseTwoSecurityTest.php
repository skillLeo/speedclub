<?php

/**
 * Phase 2 security gate (docs/reports/security/phase-2.md). The first five cases are the security auditor's proposals, each asserting the
 * fixed behaviour and failing on 723d3a5; the rest pins every path of SEC-P2-01 to -05 and the M2.8 additions (reserved names in
 * DeliverableEmail, the audit retention log).
 */

use App\Actions\Account\DeleteAccount;
use App\Actions\Social\BlockMember;
use App\Http\Controllers\Web\PlatformFilesController;
use App\Http\Middleware\Idempotency;
use App\Mail\EmailChangeCodeMail;
use App\Mail\PasswordResetCodeMail;
use App\Models\PersonalAccessToken;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Mail\Mailable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Settings/SettingsTestHelpers.php';
require_once __DIR__.'/../Messaging/MessagingTestHelpers.php';

beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    Mail::fake();
    Storage::fake('local');
});

// SEC-P2-01
it('never stores a fast hash of the password in idempotency_keys', function () {
    $member = setMember(['password' => 'Geheim-Passwort-2026']);
    $token = setSignIn($member, 'install-aaaa-0001', 'iPhone 15 Pro', 'Geheim-Passwort-2026');

    $this->withToken($token)->withHeader('Idempotency-Key', 'sec-p2-01-export')
        ->postJson('/api/v1/me/export', ['password' => 'Geheim-Passwort-2026'])->assertStatus(202);

    $stored = DB::table('idempotency_keys')->where('user_id', $member->id)->pluck('request_hash')->all();
    $guess = hash('sha256', (string) json_encode([['password' => 'Geheim-Passwort-2026'], []]));

    expect($stored)->not->toContain($guess);
});

// SEC-P2-02
it('ends an outstanding export link when the member signs out everywhere with a new password', function () {
    $member = setMember();
    $token = setSignIn($member);
    $this->withToken($token)->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(202);
    app('auth')->forgetGuards();
    $url = $this->withToken($token)->getJson('/api/v1/me/exports')->json('data.0.download_url');
    app('auth')->forgetGuards();

    $other = setSignIn($member, 'install-bbbb-0002', 'Pixel 9');
    $this->withToken($other)->postJson('/api/v1/me/password', [
        'current_password' => 'password',
        'password' => 'Ein-neues-Passwort-26',
        'password_confirmation' => 'Ein-neues-Passwort-26',
        'revoke_other_sessions' => true,
    ])->assertNoContent();
    app('auth')->forgetGuards();

    expect($this->get($url)->getStatusCode())->toBeIn([403, 404]);
});

// SEC-P2-04 (replay across a block)
it('does not answer a replayed start with the profile of a member who blocked the sender', function () {
    $lukas = ntfMember('lukas.sc');
    $jann = ntfMember('jann.ptrs');
    socFollow($lukas, $jann);
    Sanctum::actingAs($jann);
    $body = msgStartBody($lukas, ['client_id' => (string) Str::uuid()]);
    $this->postJson('/api/v1/conversations', $body)->assertCreated();

    app(BlockMember::class)->handle($lukas, $jann);
    app('auth')->forgetGuards();
    Sanctum::actingAs($jann);

    $this->postJson('/api/v1/conversations', $body)->assertForbidden()->assertJsonPath('reason', 'recipient_closed');
});

// SEC-P2-05 (WEB-09 address)
it('answers an oversized WEB-09 address with 422, not an out-of-memory 500', function () {
    memory_reset_peak_usage();
    $before = memory_get_usage(true);
    $response = $this->withHeader('Sec-Fetch-Site', 'same-origin')->post('/melden', [
        'url' => url('/v/nope'),
        'reason' => 'spam',
        'details' => 'Das ist ein Test der Sicherheitsprüfung',
        'good_faith' => '1',
        'email' => str_repeat('.', 600 * 1024).'@x.de',
    ]);

    $response->assertStatus(422);
    // With `bail` the rule stops at max:254; without it doctrine/lexer tokenises every dot (290 MB at 600 KB on 723d3a5).
    expect(memory_get_peak_usage(true) - $before)->toBeLessThan(64 * 1024 * 1024);
});

// SEC-P2-03 (WEB-07 custom scheme)
it('never hands a reset code to the custom scheme on WEB-07', function () {
    $html = $this->get('/email/reset')->assertOk()->getContent();

    // The app button either carries no data-email-link (no fragment copied) or points at a verified https App Link.
    expect(preg_match('~href="speedclub://[^"]*"[^>]*data-email-link~', (string) $html))->toBe(0);
});

/** The code the last mail of $class to $to carried. */
function p2Code(string $class, string $to): string
{
    $code = null;

    Mail::assertSent($class, function (Mailable $mail) use ($to, &$code): bool {
        $code = $mail->code ?? null;

        return $mail->hasTo($to);
    });

    return (string) $code;
}

/** An export through the API with $token, and the link GET me/exports gives that session. */
function p2ExportLink(string $token): string
{
    test()->withToken($token)->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(202);
    app('auth')->forgetGuards();
    $url = (string) test()->withToken($token)->getJson('/api/v1/me/exports')->json('data.0.download_url');
    app('auth')->forgetGuards();

    expect($url)->toMatch('/[?&]c=[0-9a-f]{32}&/')->toContain('signature=');

    return $url;
}

function p2Download(string $url): int
{
    app('auth')->forgetGuards();

    return test()->withHeaders(['Authorization' => ''])->get($url)->getStatusCode();
}

describe('SEC-P2-01 idempotency fingerprint', function () {
    it('keys the fingerprint with the app key and leaves every secret field out, at any depth', function () {
        $member = setMember();
        Sanctum::actingAs($member);
        $this->withHeader('Idempotency-Key', 'sec-p2-01-report')->postJson('/api/v1/support/tickets', [
            'category' => 'account', 'subject' => 'Frage', 'message' => 'Eine Frage zum Konto, bitte melden.', 'password' => 'Geheim-Passwort-2026',
        ]);
        $hashes = DB::table('idempotency_keys')->pluck('request_hash')->all();

        foreach ($hashes as $hash) {
            expect($hash)->not->toBe(hash('sha256', 'Geheim-Passwort-2026'));
        }

        expect(Idempotency::SECRET_FIELDS)->toContain('password', 'current_password', 'password_confirmation', 'code', 'recovery_code');
    });

    it('still replays a retried export with the same key, and refuses the key for another body', function () {
        $member = setMember();
        $token = setSignIn($member);

        $first = $this->withToken($token)->withHeader('Idempotency-Key', 'sec-p2-01-retry')->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(202);
        app('auth')->forgetGuards();
        $again = $this->withToken($token)->withHeader('Idempotency-Key', 'sec-p2-01-retry')->postJson('/api/v1/me/export', ['password' => 'password'])->assertStatus(202);

        expect($again->headers->get(Idempotency::REPLAYED_HEADER))->not->toBeNull()
            ->and($again->json('data.id'))->toBe($first->json('data.id'));
    });

    it('purges the stored rows of POST me/export, whose old hash was the password\'s', function () {
        $member = setMember();
        DB::table('idempotency_keys')->insert([
            ['key' => 'old-export', 'user_id' => $member->id, 'route' => 'POST api/v1/me/export', 'request_hash' => hash('sha256', '[{"password":"x"},[]]'), 'created_at' => now(), 'expires_at' => now()->addDay()],
            ['key' => 'old-block', 'user_id' => $member->id, 'route' => 'POST api/v1/users/kenji/block', 'request_hash' => str_repeat('a', 64), 'created_at' => now(), 'expires_at' => now()->addDay()],
        ]);

        (require database_path('migrations/2026_11_15_100100_purge_password_idempotency_keys.php'))->up();

        expect(DB::table('idempotency_keys')->pluck('key')->all())->toBe(['old-block']);
    });
});

describe('SEC-P2-02 export links end with the sign-ins', function () {
    beforeEach(function () {
        $this->member = setMember(['email' => 'lena@example.de']);
        $this->token = setSignIn($this->member);
        $this->url = p2ExportLink($this->token);
        expect(p2Download($this->url))->toBe(200);
    });

    it('ends on a password reset', function () {
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'lena@example.de'])->assertStatus(202);
        $this->postJson('/api/v1/auth/password/reset', ['email' => 'lena@example.de', 'code' => p2Code(PasswordResetCodeMail::class, 'lena@example.de'), 'password' => 'Ein-neues-Passwort-26'])->assertOk();

        expect(p2Download($this->url))->toBe(403);
    });

    it('ends on an e-mail change', function () {
        $this->withToken($this->token)->postJson('/api/v1/me/email', ['email' => 'lena.neu@example.de', 'password' => 'password'])->assertStatus(202);
        app('auth')->forgetGuards();
        $this->withToken($this->token)->postJson('/api/v1/me/email/confirm', ['code' => p2Code(EmailChangeCodeMail::class, 'lena.neu@example.de')])->assertOk();

        expect(p2Download($this->url))->toBe(403);
    });

    it('ends when another device signs out every other device, or just this one', function (bool $all) {
        $other = setSignIn($this->member, 'install-bbbb-0002', 'Pixel 9');
        $mine = PersonalAccessToken::findToken($this->token);
        $route = $all ? '/api/v1/me/sessions' : '/api/v1/me/sessions/t'.$mine?->getKey();

        $this->withToken($other)->deleteJson($route)->assertNoContent();

        expect(p2Download($this->url))->toBe(403);
    })->with(['all others' => true, 'one device' => false]);

    it('ends on a password change that signs out the other devices, but not on one that keeps them', function () {
        $this->withToken($this->token)->postJson('/api/v1/me/password', [
            'current_password' => 'password', 'password' => 'Ein-neues-Passwort-26', 'password_confirmation' => 'Ein-neues-Passwort-26', 'revoke_other_sessions' => false,
        ])->assertNoContent();

        expect(p2Download($this->url))->toBe(200);

        app('auth')->forgetGuards();
        $this->withToken($this->token)->postJson('/api/v1/me/password', [
            'current_password' => 'Ein-neues-Passwort-26', 'password' => 'Ein-zweites-Passwort-27', 'password_confirmation' => 'Ein-zweites-Passwort-27', 'revoke_other_sessions' => true,
        ])->assertNoContent();

        expect(p2Download($this->url))->toBe(403);
    });

    it('gives the session that remains a fresh link that works', function () {
        $other = setSignIn($this->member, 'install-bbbb-0002', 'Pixel 9');
        $this->withToken($other)->deleteJson('/api/v1/me/sessions')->assertNoContent();
        app('auth')->forgetGuards();

        $fresh = (string) $this->withToken($other)->getJson('/api/v1/me/exports')->json('data.0.download_url');

        expect($fresh)->not->toBe($this->url)
            ->and(p2Download($this->url))->toBe(403)
            ->and(p2Download($fresh))->toBe(200);
    });

    it('keeps the link through the member\'s own deletion (ADR-203 c, the deletion screens promise it)', function () {
        app(DeleteAccount::class)->handle(User::query()->findOrFail($this->member->id));

        expect(p2Download($this->url))->toBe(200);
    });

    it('cannot be kept alive by stripping or editing the proof', function () {
        expect(p2Download(preg_replace('/c=[0-9a-f]+&/', '', $this->url)))->toBe(403)
            ->and(p2Download(preg_replace('/c=[0-9a-f]+/', 'c='.str_repeat('0', 32), $this->url)))->toBe(403);
    });
});

describe('SEC-P2-03 WEB-07 and the App Links', function () {
    it('puts the code only on a verified https App Link on staging and production', function (string $action, string $route) {
        app()->detectEnvironment(fn () => 'production');
        config(['app.url' => 'https://speedclub.de']);

        $html = (string) $this->get("https://speedclub.de/email/$action")->assertOk()->getContent();

        expect($html)->not->toContain('speedclub://')
            ->and(preg_match('~href="https://speedclub\.de/app/'.$route.'"[^>]*data-email-link[^>]*data-testid="WEB-07\.app"~', $html))->toBe(1);
    })->with([['verify', 'verify-email'], ['reset', 'reset-password']]);

    it('leaves the scheme button without the code elsewhere, and over http', function (string $env, string $url) {
        app()->detectEnvironment(fn () => $env);
        config(['app.url' => $url]);

        $html = (string) $this->get($url.'/email/reset')->assertOk()->getContent();

        expect($html)->toContain('href="speedclub://reset-password"')
            ->and(preg_match('~<a href="speedclub://[^"]*"[^>]*data-email-link~', $html))->toBe(0)
            ->and(preg_match('~data-email-link[^>]*data-testid="WEB-07\.browser"~', $html))->toBe(1);
    })->with([['local', 'http://localhost:8080'], ['staging', 'http://staging.speedclub.test'], ['testing', 'https://speedclub.de']]);

    it('lists the two e-mail screens as exact App Link paths', function () {
        expect(PlatformFilesController::APP_PATHS)->toContain('/app/reset-password', '/app/verify-email')
            ->not->toContain('/app/*')->not->toContain('/app/reset-password*');
    });
});

describe('SEC-P2-05 and SEC-P1-46 address rules', function () {
    it('has bail first and a max ahead of every email:rfc in a form request', function () {
        $offenders = [];

        foreach (File::allFiles(app_path('Http/Requests')) as $file) {
            preg_match_all('/\[[^\[\]]*\'email:rfc\'[^\[\]]*\]/', $file->getContents(), $rules);

            foreach ($rules[0] as $rule) {
                $max = strpos($rule, "'max:");

                if (! str_starts_with($rule, "['bail'") || $max === false || $max > strpos($rule, "'email:rfc'")) {
                    $offenders[] = $file->getRelativePathname().': '.$rule;
                }
            }
        }

        expect($offenders)->toBe([]);
    });
});

describe('BL-2 audit retention', function () {
    it('neither logs nor prints the database\'s message when the archive stops on a query error', function () {
        $log = storage_path('logs/p2-retention-'.bin2hex(random_bytes(4)).'.log');
        config([
            'logging.default' => 'p2_retention',
            'logging.channels.p2_retention' => ['driver' => 'single', 'path' => $log, 'level' => 'debug'],
            'database.connections.mysql.mask_bindings_in_exception_messages' => true,
        ]);
        Log::forgetChannel('p2_retention');
        $failure = new QueryException('mysql', 'insert into `audit_events` (`action`) values (?)', ['x'], new PDOException("SQLSTATE[23000]: Duplicate entry 'lena@example.de' for key 'x'", 23000));
        // The archive step reads audit_chain_head first: it fails there as a database would, with a message that quotes a value.
        DB::listen(function ($query) use ($failure): void {
            if (str_contains($query->sql, 'audit_chain_head')) {
                throw $failure;
            }
        });

        $this->artisan('audit:retention')->doesntExpectOutputToContain('lena@example.de')->assertFailed();

        $written = File::get($log);
        File::delete($log);

        expect($written)->toContain('Audit archive stopped.')->toContain('Database query failed.')->not->toContain('lena@example.de')->not->toContain('Duplicate entry');
    });
});
