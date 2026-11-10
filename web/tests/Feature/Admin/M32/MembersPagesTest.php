<?php

use App\Actions\Admin\Members\RecordMemberListExport;
use App\Enums\AdminMemberEvent;
use App\Enums\ApprovalStatus;
use App\Enums\RestrictionType;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\DataExport;
use App\Models\Message;
use App\Models\PersonalAccessToken;
use App\Models\User;
use App\Services\Approvals\HandlerRegistry;
use App\Support\ViewAs;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/*
 * ADM-09 / ADM-10 over HTTP (m3.2-contract §2, §3, §5): matrices per route and action for the six roles, four-eyes requests that never
 * execute from their endpoint, recent-password refusals, masked addresses in every prop (SEC-P3-02), audited reveal and message
 * metadata without content, and the view-as URL only in a no-store JSON answer (SF-8).
 */
beforeEach(function () {
    Mail::fake();
});

describe('authorisation matrix: pages', function () {
    beforeEach(fn () => $this->member = adm32Member());

    it('lets members.view open the list', function () {
        assertAdminMatrix('GET', '/admin/members', ['owner', 'admin', 'moderator', 'support', 'analyst'], fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Members/Index')));
    });

    it('lets members.view open the record, by ULID and by username', function (string $key) {
        $uri = '/admin/members/'.($key === 'id' ? $this->member->id : $this->member->username);
        assertAdminMatrix('GET', $uri, ['owner', 'admin', 'moderator', 'support', 'analyst'], fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Members/Show')->where('member.id', $this->member->id)));
    })->with(['id', 'username']);

    it('lets members.view download the masked list CSV', function () {
        // ADR-232: lists.export; the Analyst sees the list but gets no file.
        assertAdminMatrix('GET', '/admin/members/export.csv', ['owner', 'admin', 'moderator', 'support'], fn (TestResponse $r) => $r->assertOk()->assertHeader('Cache-Control', 'no-store, private'));
    });

    it('refuses the list CSV to the Analyst with 403 and audits no export (MF-1, ADR-232)', function () {
        seedStaffRoles();
        $before = AuditEvent::query()->where('action', AdminMemberEvent::ListExported->value)->count();

        actingAsStaff(staffWithRole('analyst'))->get('/admin/members/export.csv')->assertForbidden();

        expect(AuditEvent::query()->where('action', AdminMemberEvent::ListExported->value)->count())->toBe($before);
    });

    it('refuses the list export in the Action too when lists.export is missing (MF-1)', function () {
        seedStaffRoles();

        expect(fn () => app(RecordMemberListExport::class)->handle(staffWithRole('analyst'), [], 0))->toThrow(AuthorizationException::class);
    });

    it('answers 404 for a member that does not exist', function () {
        seedStaffRoles();
        assertAdminErrorPage(actingAsStaff(staffWithRole('owner'))->get('/admin/members/01jzzzzzzzzzzzzzzzzzzzzzzz'), 404);
    });
});

describe('authorisation matrix: actions', function () {
    beforeEach(fn () => $this->member = adm32Member());

    it('guards each action with its atom', function (string $method, string $path, array $allowed, array $data) {
        adm32WriteMatrix($method, '/admin/members/'.$this->member->id.$path, $allowed, $data);
    })->with([
        'edit' => ['PATCH', '', ['owner', 'admin'], ['display_name' => 'Jonas M.', 'reason' => adm32Reason()]],
        'restrict' => ['POST', '/restrict', ['owner', 'admin', 'moderator'], ['type' => 'messaging', 'reason' => adm32Reason(), ...adm32Statement()]],
        'suspend' => ['POST', '/suspend', ['owner', 'admin', 'moderator'], ['until' => now()->addDays(7)->toIso8601String(), 'reason' => adm32Reason(), ...adm32Statement()]],
        'lift' => ['POST', '/lift', ['owner', 'admin', 'moderator'], ['type' => 'messaging', 'facts' => 'Die Einschränkung endet vorzeitig.', 'reason' => adm32Reason()]],
        'reset link' => ['POST', '/reset-link', ['owner', 'admin', 'support'], ['reason' => adm32Reason()]],
        'force password change' => ['POST', '/force-password-change', ['owner', 'admin', 'support'], ['reason' => adm32Reason()]],
        'revoke sessions' => ['POST', '/revoke-sessions', ['owner', 'admin', 'support'], ['reason' => adm32Reason()]],
        'reset 2fa' => ['POST', '/reset-two-factor', ['owner', 'admin'], ['reason' => adm32Reason()]],
        'e-mail' => ['POST', '/email', ['owner', 'admin'], ['email' => 'neu@example.org', 'identity_verified' => true, 'reason' => adm32Reason()]],
        'export' => ['POST', '/export', ['owner', 'admin'], ['reason' => adm32Reason()]],
        'delete' => ['POST', '/delete', ['owner', 'admin'], ['reason' => adm32Reason(), 'confirm' => 'LÖSCHEN']],
        'view-as' => ['POST', '/view-as', ['owner', 'admin', 'support'], ['reason' => adm32Reason(), 'member_consented' => true]],
        'reveal' => ['POST', '/pii', ['owner', 'admin', 'support'], []],
    ]);

    it('guards the bulk endpoint with the atom of the chosen action', function (string $action, array $allowed) {
        $other = User::factory()->create();
        adm32WriteMatrix('POST', '/admin/members/bulk', $allowed, ['action' => $action, 'ids' => [$other->id], 'reason' => adm32Reason()]);
    })->with([
        'revoke sessions' => ['revoke_sessions', ['owner', 'admin', 'support']],
        'export' => ['export', ['owner', 'admin']],
        'delete' => ['delete', ['owner', 'admin']],
    ]);
});

describe('recent password (ADR-215)', function () {
    it('refuses a sensitive write with a stale confirmation and changes nothing', function (string $path, array $data) {
        seedStaffRoles();
        $member = adm32Member();
        $this->withSession(['auth.password_confirmed_at' => time() - 301]);

        actingAsStaff(staffWithRole('owner'))->from('/admin/members/'.$member->id)
            ->post('/admin/members/'.$member->id.$path, $data)
            ->assertStatus(303)
            ->assertSessionHas('confirm_password', true);

        expect($member->fresh()?->restrictions)->toBeNull()
            ->and(ApprovalRequest::query()->count())->toBe(0)
            ->and(PersonalAccessToken::query()->where('tokenable_id', $member->id)->count())->toBe(0);
    })->with([
        'restrict' => ['/restrict', ['type' => 'messaging', 'reason' => adm32Reason(), ...adm32Statement()]],
        'suspend' => ['/suspend', ['reason' => adm32Reason(), ...adm32Statement(), 'until' => now()->addDays(3)->toIso8601String()]],
        'revoke sessions' => ['/revoke-sessions', ['reason' => adm32Reason()]],
        'reset 2fa' => ['/reset-two-factor', ['reason' => adm32Reason()]],
        'force password change' => ['/force-password-change', ['reason' => adm32Reason()]],
        // SF-4 of the M3.2 review: a reverse decision is as sensitive as the restriction it lifts.
        'lift' => ['/lift', ['type' => 'messaging', 'facts' => 'Die Einschränkung war nicht nötig, das Mitglied hat es erklärt.', 'reason' => adm32Reason()]],
    ]);

    it('answers the JSON view-as start with 403 password_confirmation_required and issues no token (SF-4)', function () {
        seedStaffRoles();
        $member = adm32Member();
        $this->withSession(['auth.password_confirmed_at' => time() - 301]);

        actingAsStaff(staffWithRole('owner'))
            ->postJson('/admin/members/'.$member->id.'/view-as', ['reason' => adm32Reason(), 'member_consented' => false])
            ->assertStatus(403)
            ->assertJsonPath('code', 'password_confirmation_required');

        expect(PersonalAccessToken::query()->where('tokenable_id', $member->id)->count())->toBe(0);
    });
});

describe('ADM-09 list', function () {
    it('masks every address, also for members.view_pii (SEC-P3-02), and never sends the full one', function (string $role) {
        $member = adm32Member();
        adm32SignedIn($role);

        $response = $this->get('/admin/members')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('rows.data.0.email', 'j***@g***.de')
            ->has('rows.data.0.restricted')
            ->missing('rows.data.0.password'));

        expect((string) $response->getContent())->not->toContain($member->email);
    })->with(['owner', 'support', 'moderator', 'analyst']);

    it('filters by username prefix, status, restriction and reported', function () {
        adm32Member();
        User::factory()->restrictedFrom(RestrictionType::Messaging)->create(['username' => 'tina.rest']);
        User::factory()->suspended()->create(['username' => 'sven.susp']);
        adm32SignedIn('owner');

        $this->get('/admin/members?filter[q]=jon')->assertInertia(fn (AssertableInertia $p) => $p->has('rows.data', 1)->where('rows.data.0.username', 'jonas.adm'));
        $this->get('/admin/members?filter[restricted]=messaging')->assertInertia(fn (AssertableInertia $p) => $p->has('rows.data', 1)->where('rows.data.0.username', 'tina.rest'));
        $this->get('/admin/members?filter[restricted]=any')->assertInertia(fn (AssertableInertia $p) => $p->has('rows.data', 2));
        $this->get('/admin/members?filter[status]=suspended')->assertInertia(fn (AssertableInertia $p) => $p->has('rows.data', 1)->where('rows.data.0.status', 'suspended'));
        $this->get('/admin/members?filter[reported]=1')->assertInertia(fn (AssertableInertia $p) => $p->has('rows.data', 0));
    });

    it('matches an exact address only for members.view_pii', function () {
        adm32Member();

        adm32SignedIn('support');
        $this->get('/admin/members?filter[q]=jonas.adm@gmail.de')->assertInertia(fn (AssertableInertia $p) => $p->has('rows.data', 1));

        adm32SignedIn('analyst');
        $this->get('/admin/members?filter[q]=jonas.adm@gmail.de')->assertInertia(fn (AssertableInertia $p) => $p->has('rows.data', 0));
    });

    it('orders by a whitelisted sort with the id as tie-breaker', function () {
        User::factory()->count(3)->create(['created_at' => now()->subDay()]);
        adm32SignedIn('owner');

        $first = $this->get('/admin/members?sort=created_at')->inertiaProps('rows.data');
        $again = $this->get('/admin/members?sort=created_at')->inertiaProps('rows.data');

        expect(array_column($first, 'id'))->toBe(array_column($again, 'id'));
        $this->get('/admin/members?sort=email')->assertStatus(400);
    });

    it('writes a masked CSV, audited', function () {
        $member = adm32Member();
        adm32SignedIn('owner');

        $csv = $this->get('/admin/members/export.csv')->assertOk()->streamedContent();

        expect($csv)->toContain('email_masked')->toContain('j***@g***.de')->not->toContain($member->email)
            ->and(AuditEvent::query()->where('action', 'member.list_exported')->count())->toBe(1);
    });
});

describe('ADM-09 bulk', function () {
    it('revokes sessions of up to 100 members at once and flashes the per-record rows', function () {
        $members = User::factory()->count(2)->create();
        adm32SignedIn('support');

        $this->from('/admin/members')->post('/admin/members/bulk', ['action' => 'revoke_sessions', 'ids' => [...$members->pluck('id')->all(), '01jzzzzzzzzzzzzzzzzzzzzzzz'], 'reason' => adm32Reason()])
            ->assertStatus(303)->assertSessionHas('error', 'members.flash.bulk_partial');

        $this->get('/admin/members')->assertInertia(fn (AssertableInertia $p) => $p->where('bulkResult.action', 'revoke_sessions')->has('bulkResult.rows', 3)->where('bulkResult.rows.2.ok', false));
    });

    it('asks for an approval for export and delete at any count, and above 100 records, and changes nothing', function (string $action, int $count) {
        $members = User::factory()->count($count)->create();
        adm32SignedIn('owner');

        $this->from('/admin/members')->post('/admin/members/bulk', ['action' => $action, 'ids' => $members->pluck('id')->all(), 'reason' => adm32Reason()])
            ->assertStatus(303)->assertSessionHas('approval');

        $request = ApprovalRequest::query()->sole();
        expect($request->action)->toBe('members.bulk')->and($request->status)->toBe(ApprovalStatus::Pending)
            ->and(User::query()->whereNotNull('deletion_requested_at')->count())->toBe(0)
            ->and(AuditEvent::query()->where('action', 'member.sessions_revoked_by_staff')->count())->toBe(0);
    })->with([
        'export' => ['export', 1],
        'delete' => ['delete', 1],
        'revoke above 100' => ['revoke_sessions', 101],
    ]);

    it('refuses more than 500 ids', function () {
        adm32SignedIn('owner');
        $ids = array_map(fn () => strtolower((string) Str::ulid()), range(1, 501));

        $this->from('/admin/members')->post('/admin/members/bulk', ['action' => 'revoke_sessions', 'ids' => $ids, 'reason' => adm32Reason()])->assertSessionHasErrors('ids');
    });
});

describe('ADM-10 record', function () {
    it('masks the address in every prop, reveals it on an audited JSON request only for members.view_pii', function () {
        $member = adm32Member();
        adm32SignedIn('support');

        $page = $this->get('/admin/members/'.$member->id);
        expect((string) $page->getContent())->not->toContain($member->email);

        $this->post('/admin/members/'.$member->id.'/pii', [], ['X-Inertia' => 'true'])->assertStatus(409);
        $this->postJson('/admin/members/'.$member->id.'/pii')
            ->assertOk()->assertJsonPath('email', $member->email)
            ->assertHeader('Cache-Control', 'no-store, private');

        expect(AuditEvent::query()->where('action', 'member.pii_viewed')->count())->toBe(1);

        adm32SignedIn('analyst');
        assertAdminErrorPage($this->post('/admin/members/'.$member->id.'/pii'), 403);
    });

    it('reads only the open tab, and audits message metadata only when that tab is opened', function () {
        $member = adm32Member();
        adm32SignedIn('owner');

        $this->get('/admin/members/'.$member->id)->assertInertia(fn (AssertableInertia $p) => $p->where('tab', 'overview')->missing('security')->missing('messages')->has('activity'));
        expect(AuditEvent::query()->where('action', 'member.message_metadata_viewed')->count())->toBe(0);

        $this->get('/admin/members/'.$member->id.'?tab=security')->assertInertia(fn (AssertableInertia $p) => $p->where('tab', 'security')->has('security.devices'));
        $this->get('/admin/members/'.$member->id.'?tab=messages')->assertInertia(fn (AssertableInertia $p) => $p->where('tab', 'messages')->has('messages.conversations'));

        expect(AuditEvent::query()->where('action', 'member.message_metadata_viewed')->count())->toBe(1);
    });

    it('never puts message content in the props', function () {
        $member = adm32Member();
        $other = User::factory()->create();
        $conversation = Conversation::factory()->create(['created_by' => $member->id]);
        ConversationParticipant::factory()->create(['conversation_id' => $conversation->id, 'user_id' => $member->id]);
        ConversationParticipant::factory()->create(['conversation_id' => $conversation->id, 'user_id' => $other->id]);
        Message::factory()->create(['conversation_id' => $conversation->id, 'sender_id' => $member->id, 'body' => 'Streng geheimer Nachrichtentext']);
        adm32SignedIn('owner');

        $html = (string) $this->get('/admin/members/'.$member->id.'?tab=messages')->getContent();

        expect($html)->not->toContain('Streng geheimer Nachrichtentext')->not->toContain('"body"');
    });

    it('falls back to the overview for a tab the role may not open', function () {
        $member = adm32Member();
        adm32SignedIn('moderator');

        $this->get('/admin/members/'.$member->id.'?tab=messages')->assertInertia(fn (AssertableInertia $p) => $p->where('tab', 'overview')->missing('messages'));
        expect(AuditEvent::query()->where('action', 'member.message_metadata_viewed')->count())->toBe(0);
    });

    it('restricts through a decision, audited, and lifts it again', function () {
        $member = adm32Member();
        adm32SignedIn('moderator');

        $this->from('/admin/members/'.$member->id)->post('/admin/members/'.$member->id.'/restrict', ['type' => 'messaging', 'until' => now()->addDays(7)->toIso8601String(), 'reason' => adm32Reason(), ...adm32Statement()])
            ->assertStatus(303)->assertSessionHas('success', 'members.flash.restricted');

        expect($member->fresh()?->isRestrictedFrom(RestrictionType::Messaging))->toBeTrue()
            ->and(AuditEvent::query()->where('action', 'moderation.decided')->count())->toBe(1);

        $this->from('/admin/members/'.$member->id)->post('/admin/members/'.$member->id.'/lift', ['type' => 'messaging', 'facts' => 'Die Einschränkung endet vorzeitig.', 'reason' => adm32Reason()])
            ->assertStatus(303)->assertSessionHas('success', 'members.flash.lifted');

        expect($member->fresh()?->isRestrictedFrom(RestrictionType::Messaging))->toBeFalse();
    });

    it('validates the statement of reasons and the reason', function () {
        $member = adm32Member();
        adm32SignedIn('owner');

        $this->from('/admin/members/'.$member->id)->post('/admin/members/'.$member->id.'/restrict', ['type' => 'messaging', 'reason' => 'kurz'])
            ->assertSessionHasErrors(['reason', 'facts', 'ground', 'ground_document']);
    });

    it('creates approval requests for the four-eyes actions and executes none of them', function (string $path, string $handler, array $data) {
        $member = adm32Member(['two_factor_secret' => encrypt('JBSWY3DPEHPK3PXP'), 'two_factor_confirmed_at' => now()]);
        adm32SignedIn('owner');

        $this->from('/admin/members/'.$member->id)->post('/admin/members/'.$member->id.$path, $data)->assertStatus(303)->assertSessionHas('approval');

        $request = ApprovalRequest::query()->sole();
        $fresh = $member->fresh();
        expect($request->action)->toBe($handler)->and($request->status)->toBe(ApprovalStatus::Pending)
            ->and($fresh?->isSuspended())->toBeFalse()
            ->and($fresh?->hasTwoFactor())->toBeTrue()
            ->and($fresh?->isPendingDeletion())->toBeFalse()
            ->and(DataExport::query()->count())->toBe(0);
    })->with([
        'suspend' => ['/suspend', 'moderation.suspend', ['until' => now()->addDays(7)->toIso8601String(), 'reason' => adm32Reason(), ...adm32Statement()]],
        'reset 2fa' => ['/reset-two-factor', 'members.reset_2fa', ['reason' => adm32Reason()]],
        'export' => ['/export', 'members.export', ['reason' => adm32Reason()]],
        'delete' => ['/delete', 'members.delete', ['reason' => adm32Reason(), 'confirm' => 'LÖSCHEN']],
    ]);

    it('refuses a deletion without the typed word', function () {
        $member = adm32Member();
        adm32SignedIn('owner');

        $this->from('/admin/members/'.$member->id)->post('/admin/members/'.$member->id.'/delete', ['reason' => adm32Reason(), 'confirm' => 'loeschen'])->assertSessionHasErrors('confirm');
        expect(ApprovalRequest::query()->count())->toBe(0);
    });

    it('caps a moderator suspension at 30 days', function () {
        $member = adm32Member();
        adm32SignedIn('moderator');

        $this->from('/admin/members/'.$member->id)->post('/admin/members/'.$member->id.'/suspend', ['until' => now()->addDays(45)->toIso8601String(), 'reason' => adm32Reason(), ...adm32Statement()])
            ->assertSessionHasErrors('until');
        expect(ApprovalRequest::query()->count())->toBe(0);
    });

    it('edits the profile with a reason, never a password', function () {
        $member = adm32Member();
        adm32SignedIn('admin');

        $this->from('/admin/members/'.$member->id)->patch('/admin/members/'.$member->id, ['display_name' => 'Jonas Meier', 'username' => 'jonas.meier', 'password' => 'geheim123', 'reason' => adm32Reason()])
            ->assertStatus(303)->assertSessionHas('success', 'members.flash.edited');

        $fresh = $member->fresh();
        expect($fresh?->username)->toBe('jonas.meier')->and($fresh?->getAttribute('display_name'))->toBe('Jonas Meier')
            ->and(password_verify('geheim123', (string) $fresh?->password))->toBeFalse();
    });

    it('changes the e-mail address only with the identity checkbox', function () {
        $member = adm32Member();
        adm32SignedIn('owner');

        $this->from('/admin/members/'.$member->id)->post('/admin/members/'.$member->id.'/email', ['email' => 'neu@example.org', 'reason' => adm32Reason()])->assertSessionHasErrors('identity_verified');
        expect($member->fresh()?->email)->toBe('jonas.adm@gmail.de');
    });
});

describe('ADM-10 view-as (SF-8)', function () {
    it('answers the one-time URL as no-store JSON only, and keeps the token out of the session and the flash', function () {
        $member = adm32Member();
        adm32SignedIn('support');

        $this->post('/admin/members/'.$member->id.'/view-as', ['reason' => adm32Reason(), 'member_consented' => true], ['X-Inertia' => 'true'])->assertStatus(409);

        $response = $this->postJson('/admin/members/'.$member->id.'/view-as', ['reason' => adm32Reason(), 'member_consented' => true])
            ->assertOk()->assertHeader('Cache-Control', 'no-store, private');

        $url = (string) $response->json('url');
        expect($url)->toContain('/app/#view_as=')
            ->and(array_keys((array) $response->json()))->toBe(['url', 'expires_at']);

        $token = (string) str($url)->after('view_as=')->before('&');
        expect(json_encode(session()->all()))->not->toContain($token)
            ->and(PersonalAccessToken::query()->where('name', 'like', ViewAs::NAME_PREFIX.'%')->sole()->can('view-as'))->toBeTrue()
            ->and(AuditEvent::query()->where('action', 'member.view_as_started')->count())->toBe(1);

        $this->get('/admin/members/'.$member->id)->assertInertia(fn (AssertableInertia $p) => $p->whereNot('viewAs', null));
        $this->deleteJson('/admin/members/'.$member->id.'/view-as')->assertOk();
        expect(PersonalAccessToken::query()->where('name', 'like', ViewAs::NAME_PREFIX.'%')->count())->toBe(0);
    });

    it('needs the member consent from Support', function () {
        $member = adm32Member();
        adm32SignedIn('support');

        $this->postJson('/admin/members/'.$member->id.'/view-as', ['reason' => adm32Reason()])->assertStatus(422)->assertJsonValidationErrors('member_consented');
        expect(PersonalAccessToken::query()->count())->toBe(0);
    });
});

describe('SEC-P3-03 list with addresses', function () {
    it('only asks for an approval, never streams addresses itself, when the handler exists', function () {
        adm32SignedIn('owner');

        $response = $this->from('/admin/members')->post('/admin/members/export-request', ['reason' => adm32Reason(), 'filter' => ['status' => 'active']]);

        if (! app(HandlerRegistry::class)->has('members.list_export')) {
            assertAdminErrorPage($response, 404);

            return;
        }

        $response->assertStatus(303)->assertSessionHas('approval');
        expect(ApprovalRequest::query()->sole()->action)->toBe('members.list_export');
    });

    it('is refused to staff without members.export and members.view_pii', function (string $role) {
        adm32SignedIn($role);
        assertAdminErrorPage($this->post('/admin/members/export-request', ['reason' => adm32Reason()]), 403);
    })->with(['support', 'moderator', 'analyst', 'content_editor']);
});
