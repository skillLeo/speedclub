<?php

use App\Actions\Admin\Moderation\PublishRateLimits;
use App\Actions\Admin\Support\AddTicketNote;
use App\Actions\Admin\Team\ApplyPermissionMatrix;
use App\Actions\Admin\Team\ChangeStaffRoles;
use App\Actions\Admin\Team\DeleteRole;
use App\Actions\Admin\Team\SaveRole;
use App\Actions\Support\CreateSupportTicket;
use App\Enums\AiFeature;
use App\Enums\ApprovalStatus;
use App\Enums\DataExportStatus;
use App\Enums\KeywordList;
use App\Enums\SupportCategory;
use App\Http\Controllers\Admin\Support\AlertsData;
use App\Models\AiCall;
use App\Models\AuditEvent;
use App\Models\DataExport;
use App\Models\Media;
use App\Models\Role;
use App\Models\SupportTicket;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Ai\Agents\TranslateAgent;
use App\Services\Ai\AiGateway;
use App\Services\Approvals\Approvals;
use App\Services\Rules\RateLimitOverrides;
use App\Services\Team\TeamRefused;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Admin/Actions/Helpers.php';
require_once __DIR__.'/../Admin/M34/Helpers.php';
require_once __DIR__.'/../Ai/AiTestHelpers.php';
require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * The fixes of security round 2 (docs/reports/security/phase-3.md §6.3) beyond the auditor's own finding tests
 * (PhaseThreeRoundTwoFindingsTest): the one-off export expiry (SEC-P3-12), the role pins and the rename lock (SEC-P3-13), the three new
 * screened fields (SEC-P3-15), the AI caps (SEC-P3-19), the protected limiters (SEC-P3-20) and the address-reveal cap (SEC-P3-21).
 */
beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    $this->withoutDefer();
    Mail::fake();
    RateLimitOverrides::flush();
});

afterEach(fn () => RateLimitOverrides::flush());

describe('SEC-P3-12: exports built before the fix', function () {
    it('expires the member\'s ready export when a ticket of theirs has a note, and nothing else', function () {
        $noted = User::factory()->create();
        $ticket = app(CreateSupportTicket::class)->forMember($noted, SupportCategory::cases()[0], 'Konto gesperrt?', 'Warum kann ich nicht schreiben?');
        app(AddTicketNote::class)->handle(m31Staff('support'), $ticket, 'INTERN: Zweitkonto prüfen.');
        $plain = User::factory()->create();
        SupportTicket::factory()->create(['user_id' => $plain->id]);
        $staffCopy = m31Staff('admin');

        $export = function (User $user, ?int $staff = null): DataExport {
            $row = new DataExport;
            $row->forceFill([
                'user_id' => $user->id, 'status' => DataExportStatus::Ready, 'requested_at' => now(), 'ready_at' => now(), 'expires_at' => now()->addDays(7),
                'requested_by_staff_id' => $staff,
            ])->save();

            return $row;
        };
        $affected = $export($noted);
        $clean = $export($plain);
        $forStaff = $export($noted, $staffCopy->id);

        $this->artisan('speedclub:exports:expire-ticket-notes')->expectsOutputToContain('1 export(s) expired.')->assertExitCode(0);
        $this->artisan('speedclub:exports:expire-ticket-notes')->expectsOutputToContain('0 export(s) expired.');

        expect($affected->fresh()->status)->toBe(DataExportStatus::Expired)
            ->and($clean->fresh()->status)->toBe(DataExportStatus::Ready)
            ->and($forStaff->fresh()->status)->toBe(DataExportStatus::Ready);
    });
});

describe('SEC-P3-13: role approvals pin their roles', function () {
    beforeEach(function () {
        $this->requester = m31Staff('admin');
        app(SaveRole::class)->handle($this->requester, null, 'Neu', null, ['qr.view', 'vehicles.view']);
        $this->request = app(ApplyPermissionMatrix::class)->handle($this->requester, ['Neu' => ['members.export', 'qr.view', 'vehicles.view']], m32Reason())->approval;
        $this->role = Role::query()->where('name', 'Neu')->sole();
    });

    it('refuses to rename or delete a role a pending approval names, and to rename another role into that name', function () {
        app(SaveRole::class)->handle($this->requester, null, 'Helfer', null, ['qr.view']);
        $helfer = Role::query()->where('name', 'Helfer')->sole();

        $refused = fn (Closure $step): string => (function () use ($step): string {
            try {
                $step();
            } catch (TeamRefused $refused) {
                return $refused->reason.':'.$refused->status();
            }

            return 'applied';
        })();

        expect($refused(fn () => app(SaveRole::class)->handle($this->requester, $this->role, 'Neu-alt', null, ['qr.view', 'vehicles.view'])))->toBe('role_pending_approval:409')
            ->and($refused(fn () => app(DeleteRole::class)->handle($this->requester, $this->role, m32Reason())))->toBe('role_pending_approval:409')
            ->and($refused(fn () => app(SaveRole::class)->handle($this->requester, $helfer, 'Neu', null, ['qr.view'])))->not->toBe('applied')
            ->and($this->role->fresh()->name)->toBe('Neu');
    });

    it('fails the approval when somebody got the role meanwhile, and names how many hold it', function () {
        expect(collect($this->request->summary['lines'])->firstWhere('label', 'approvals.roles_sensitive_atoms.staff')['after'] ?? null)->toBe('0')
            ->and($this->request->payload['role_pins']['Neu']['id'])->toBe((int) $this->role->getKey());

        $newcomer = m31Staff('support');
        $newcomer->assignRole('Neu');
        $approved = app(Approvals::class)->approve($this->request->fresh(), m31Staff('admin'));

        expect($approved->status)->toBe(ApprovalStatus::Failed)
            ->and($newcomer->fresh()->can('members.export'))->toBeFalse();
    });

    it('applies the grant when nothing changed', function () {
        expect(app(Approvals::class)->approve($this->request->fresh(), m31Staff('admin'))->status)->toBe(ApprovalStatus::Executed)
            ->and($this->role->fresh()->hasPermissionTo('members.export'))->toBeTrue();
    });

    it('pins the roles of a staff.role_elevation and fails it when a named role\'s atoms changed', function () {
        app(SaveRole::class)->handle($this->requester, null, 'Prüfer', null, ['qr.view']);
        $target = m31Staff('support');
        $elevation = app(ChangeStaffRoles::class)->handle($this->requester, $target, ['Prüfer', 'admin'], m32Reason())->approval;
        expect($elevation->payload['role_pins'])->toHaveKeys(['admin', 'support', 'Prüfer']);

        // The custom role in the request gets another atom meanwhile: the approver saw a different role.
        app(SaveRole::class)->handle($this->requester, Role::query()->where('name', 'Prüfer')->sole(), 'Prüfer', null, ['qr.view', 'vehicles.view']);
        $approved = app(Approvals::class)->approve($elevation->fresh(), m31Staff('owner'));

        expect($approved->status)->toBe(ApprovalStatus::Failed)->and($target->fresh()->hasRole('admin'))->toBeFalse();
    });

    it('still applies a staff.role_elevation when only the holders of a role changed', function () {
        $target = m31Staff('support');
        $elevation = app(ChangeStaffRoles::class)->handle($this->requester, $target, ['admin'], m32Reason())->approval;
        m31Staff('support');

        expect(app(Approvals::class)->approve($elevation->fresh(), m31Staff('owner'))->status)->toBe(ApprovalStatus::Executed);
    });
});

describe('SEC-P3-15: nickname, mod title and photo caption are screened', function () {
    beforeEach(function () {
        adm34Rule('Darknet', KeywordList::Block);
        $this->member = User::factory()->create();
        Sanctum::actingAs($this->member);
        $this->vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->member->id]);
    });

    it('blocks a nickname', function () {
        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}", ['nickname' => "Dark\u{200B}net Express"])->assertStatus(422)->assertJsonPath('code', 'content_blocked')->assertJsonValidationErrors('nickname');
        expect((string) $this->vehicle->fresh()->nickname)->not->toContain('net Express');
    });

    it('blocks a mod title', function () {
        seedModSchema();
        $mod = modIn($this->vehicle, 'other');

        $this->patchJson("/api/v1/mods/{$mod->id}", ['title' => 'Teile aus dem Ｄａｒｋｎｅｔ'])->assertStatus(422)->assertJsonPath('code', 'content_blocked');
    });

    it('blocks a photo caption', function () {
        $photo = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->member->id]);

        $this->patchJson("/api/v1/media/{$photo->id}", ['alt' => 'Gekauft im Darknet'])->assertStatus(422)->assertJsonPath('code', 'content_blocked');
        expect($photo->fresh()->alt)->not->toBe('Gekauft im Darknet');
    });

    it('lets clean text through', function () {
        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}", ['nickname' => 'Silberpfeil'])->assertOk();
    });
});

describe('SEC-P3-19: AI caps', function () {
    beforeEach(function () {
        aiOn(AiFeature::Translate);
        TranslateAgent::fake([['refused' => false, 'text' => 'A beautiful car, built with a lot of love.']])->preventStrayPrompts();
        $this->vehicle = Vehicle::factory()->published()->create(['description' => 'Ein schöner Wagen mit viel Liebe aufgebaut.']);
        config(['speedclub.ai.member_daily_min' => 3, 'speedclub.ai.member_daily_share' => 0.0]);
    });

    it('needs a verified e-mail address', function () {
        aiActAs(aiMember(attributes: ['email_verified_at' => null]));

        $this->postJson('/api/v1/ai/translate', ['source' => 'vehicle_description', 'id' => $this->vehicle->id, 'to' => 'en'])->assertForbidden()->assertJsonPath('code', 'email_not_verified');
        TranslateAgent::assertNeverPrompted();
    });

    it('stops one member at their daily share with 429 ai_daily_limit while others go on', function () {
        $heavy = aiActAs(aiMember());
        AiCall::factory()->count(3)->create(['feature' => AiFeature::Translate, 'member_id' => $heavy->id]);

        $this->postJson('/api/v1/ai/translate', ['source' => 'vehicle_description', 'id' => $this->vehicle->id, 'to' => 'en'])
            ->assertStatus(429)->assertJsonPath('code', 'ai_daily_limit');

        app('auth')->forgetGuards();
        aiActAs(aiMember());
        $this->postJson('/api/v1/ai/translate', ['source' => 'vehicle_description', 'id' => $this->vehicle->id, 'to' => 'en'])->assertOk();
    });

    it('keeps the share below the budget and above the minimum', function () {
        config(['speedclub.ai.daily_calls.translate' => 3000, 'speedclub.ai.member_daily_share' => 0.02, 'speedclub.ai.member_daily_min' => 20]);
        expect(app(AiGateway::class)->memberBudget(AiFeature::Translate))->toBe(60);

        config(['speedclub.ai.daily_calls.translate' => 500]);
        expect(app(AiGateway::class)->memberBudget(AiFeature::Translate))->toBe(20);

        config(['speedclub.ai.daily_calls.translate' => 10]);
        expect(app(AiGateway::class)->memberBudget(AiFeature::Translate))->toBe(10);
    });
});

describe('SEC-P3-20: protected limiters', function () {
    it('keeps sign-in, code, account-security and AI limiters out of ADM-23', function () {
        $names = array_keys(RateLimitOverrides::defaults());

        expect(array_intersect($names, RateLimitOverrides::PROTECTED))->toBe([])
            ->and($names)->toContain('reports')
            ->and(fn () => app(PublishRateLimits::class)->handle(m31Staff('moderator'), ['member_login' => 40], m32Reason()))->toThrow(ValidationException::class)
            ->and(fn () => app(PublishRateLimits::class)->handle(m31Staff('moderator'), ['two_factor_challenge' => 20], m32Reason()))->toThrow(ValidationException::class);
    });

    it('ignores a stored override of a protected limiter', function () {
        RateLimitOverrides::remember(['member_login' => 40, 'reports' => 30]);

        expect(RateLimitOverrides::maxFor('member_login', 10))->toBeNull()
            ->and(RateLimitOverrides::maxFor('reports', 20))->toBe(30);
    });
});

describe('SEC-P3-21: address reveals per day', function () {
    beforeEach(fn () => config(['speedclub.staff.pii_reveals_per_day' => 2]));

    it('caps member and web-contact reveals together, audits the cap once and alerts audit.view', function () {
        $support = adm32SignedIn('support');
        $members = User::factory()->count(3)->create();
        $contact = SupportTicket::factory()->guest()->create();

        $this->postJson("/admin/members/{$members[0]->id}/pii")->assertOk();
        $this->postJson("/admin/support/tickets/{$contact->id}/contact")->assertOk();
        $this->postJson("/admin/members/{$members[1]->id}/pii")->assertStatus(429);
        $this->postJson("/admin/members/{$members[2]->id}/pii")->assertStatus(429);

        expect(AuditEvent::query()->where('action', 'staff.pii_reveal_limit_reached')->where('actor_id', (string) $support->id)->count())->toBe(1)
            ->and(AuditEvent::query()->where('action', 'member.pii_viewed')->count())->toBe(1)
            ->and(collect(app(AlertsData::class)->systemWarnings(m31Staff('owner')))->pluck('key')->all())->toContain('pii_reveal_limit')
            ->and(collect(app(AlertsData::class)->systemWarnings(m31Staff('support')))->pluck('key')->all())->not->toContain('pii_reveal_limit');
    });

    it('starts again the next day', function () {
        adm32SignedIn('support');
        $members = User::factory()->count(3)->create();
        $this->postJson("/admin/members/{$members[0]->id}/pii")->assertOk();
        $this->postJson("/admin/members/{$members[1]->id}/pii")->assertOk();
        $this->postJson("/admin/members/{$members[2]->id}/pii")->assertStatus(429);

        $this->travel(1)->day();
        $this->withSession(['auth.password_confirmed_at' => time()]);
        $this->postJson("/admin/members/{$members[2]->id}/pii")->assertOk();
    });
});
