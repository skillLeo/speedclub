<?php

use App\Actions\Me\UpdateProfile;
use App\Actions\Moderation\FileAppeal;
use App\Enums\AppealStatus;
use App\Enums\ApprovalStatus;
use App\Enums\CaseStatus;
use App\Enums\DecisionAction;
use App\Enums\DecisionViewer;
use App\Enums\KeywordList;
use App\Enums\NotificationType;
use App\Enums\ReportTargetType;
use App\Http\RateLimits;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\ConfigVersion;
use App\Models\Decision;
use App\Models\KeywordRule;
use App\Models\ModerationCase;
use App\Models\Notification;
use App\Models\Report;
use App\Models\SorTemplate;
use App\Models\Staff;
use App\Models\User;
use App\Services\Approvals\Approvals;
use App\Services\Audit\Audit;
use App\Services\Moderation\DecisionAudience;
use App\Services\Moderation\SendAppealOutcomeMail;
use App\Services\Rules\RateLimitOverrides;
use App\Support\Moderation\AppealDeadline;
use App\Support\Moderation\ModerationText;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * M3.4 moderation admin (ADM-20…24, m3.4-contract §2/§3), lane b: the authorisation matrix of every route by the 06 §2 role table,
 * suspension only through the approval, appeals by another person than the decider, evidence and message context audited and never in
 * props, the analyst without message content, rate-limit override bounds, the SoR preview DE/EN and the bulk "Keine Maßnahme" threshold.
 */
const ADM34_VIEW = ['owner', 'admin', 'moderator', 'analyst'];
const ADM34_DECIDE = ['owner', 'admin', 'moderator'];

beforeEach(fn () => Queue::fake());

describe('authorisation matrix', function () {
    it('guards the pages by moderation.view, .messages and .rules', function (string $uri, array $allowed, string $component) {
        $case = adm34VehicleCase();
        $uri = str_replace('{case}', $case->id, $uri);
        assertAdminMatrix('GET', $uri, $allowed, fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component($component)));
    })->with([
        'ADM-20' => ['/admin/moderation/reports', ADM34_VIEW, 'Moderation/Reports'],
        'ADM-20 appeals' => ['/admin/moderation/reports?tab=appeals', ADM34_VIEW, 'Moderation/Reports'],
        'ADM-20 decided' => ['/admin/moderation/reports?tab=decided', ADM34_VIEW, 'Moderation/Reports'],
        'ADM-21' => ['/admin/moderation/cases/{case}', ADM34_VIEW, 'Moderation/Case'],
        'ADM-22' => ['/admin/moderation/messages', ['owner', 'admin', 'moderator'], 'Moderation/Messages'],
        'ADM-23' => ['/admin/moderation/rules', ['owner', 'admin', 'moderator'], 'Moderation/Rules'],
        'ADM-24' => ['/admin/moderation/templates', ADM34_VIEW, 'Moderation/Templates'],
    ]);

    it('guards every write by its atom', function (string $method, string $uri, array $allowed, array $data) {
        $case = adm34VehicleCase();
        $template = SorTemplate::query()->orderBy('key')->firstOrFail();
        $rule = adm34Rule('Testbegriff', KeywordList::Flag);
        $decision = modDecide(adm34VehicleCase(), DecisionAction::RemoveContent);
        $appeal = app(FileAppeal::class)->handle(User::query()->findOrFail($decision->subject_id), $decision, DecisionViewer::Affected, 'Das war ein Missverständnis, bitte noch einmal prüfen.');
        $uri = strtr($uri, ['{case}' => $case->id, '{template}' => $template->id, '{rule}' => (string) $rule->id, '{appeal}' => $appeal->id]);

        adm32WriteMatrix($method, $uri, $allowed, $data);
    })->with([
        'assign' => ['POST', '/admin/moderation/cases/{case}/assign', ADM34_DECIDE, []],
        'decide' => ['POST', '/admin/moderation/cases/{case}/decide', ADM34_DECIDE, adm34Decision('no_action')],
        'preview' => ['POST', '/admin/moderation/cases/{case}/preview', ADM34_DECIDE, ['action' => 'no_action']],
        'evidence' => ['POST', '/admin/moderation/cases/{case}/evidence', ADM34_VIEW, []],
        'bulk' => ['POST', '/admin/moderation/reports/bulk', ADM34_DECIDE, ['action' => 'no_action', 'ids' => ['01m6xrkefah44swwdp1s6776yw'], 'reason' => adm32Reason()]],
        'appeal' => ['POST', '/admin/moderation/appeals/{appeal}/decide', ADM34_DECIDE, ['outcome' => 'upheld', 'explanation' => 'Die Entscheidung bleibt, das Foto war fremd.', 'reason' => adm32Reason()]],
        'rule add' => ['POST', '/admin/moderation/rules', ADM34_DECIDE, ['term' => 'Neuer Begriff', 'list' => 'flag', 'reason' => adm32Reason()]],
        'rule remove' => ['DELETE', '/admin/moderation/rules/{rule}', ADM34_DECIDE, ['reason' => adm32Reason()]],
        'limits' => ['POST', '/admin/moderation/rules/rate-limits', ADM34_DECIDE, ['overrides' => ['reports' => 30], 'reason' => adm32Reason()]],
        'template add' => ['POST', '/admin/moderation/templates', ADM34_DECIDE, ['key' => 'neu', 'locale' => 'de', 'action' => 'restrict', 'label' => 'Neue Vorlage', 'facts' => 'Der Inhalt {target} verstößt gegen die Regeln.', 'ground' => 'Community-Richtlinien', 'ground_document' => 'community']],
        'template edit' => ['PATCH', '/admin/moderation/templates/{template}', ADM34_DECIDE, ['key' => 'spam', 'locale' => 'de', 'action' => 'remove_content', 'label' => 'Spam', 'facts' => 'Der Inhalt {target} ist Werbung.', 'ground' => 'Keine Werbung', 'ground_document' => 'community']],
        'template delete' => ['DELETE', '/admin/moderation/templates/{template}', ADM34_DECIDE, []],
    ]);

    it('asks for a recent password before deciding a case, an appeal or a rule change', function (string $uri, array $data) {
        $case = adm34VehicleCase();
        seedStaffRoles();
        actingAsStaff(staffWithRole('moderator'));
        $this->from('/admin/moderation/reports')->post(str_replace('{case}', $case->id, $uri), $data)->assertSessionHas('confirm_password');
        expect(Decision::query()->count())->toBe(0)->and(KeywordRule::query()->count())->toBe(0);
    })->with([
        'decide' => ['/admin/moderation/cases/{case}/decide', adm34Decision('no_action')],
        'rules' => ['/admin/moderation/rules', ['term' => 'Begriff', 'list' => 'flag', 'reason' => adm32Reason()]],
    ]);
});

describe('decisions from the composer', function () {
    it('restricts the member through DecideCase with the staff member as decider', function () {
        $case = adm34VehicleCase();
        $staff = adm34As('moderator');
        $until = now()->addDays(7)->toIso8601String();

        $this->post("/admin/moderation/cases/{$case->id}/decide", adm34Decision('restrict', ['restriction' => 'messaging', 'until' => $until]))->assertSessionHas('success', 'moderation.flash.decided');

        $decision = Decision::query()->where('case_id', $case->id)->sole();
        expect($decision->action)->toBe(DecisionAction::Restrict)
            ->and($decision->decided_by)->toBe($staff->id)
            ->and($decision->automatedDecision())->toBeFalse()
            ->and($case->refresh()->status)->toBe(CaseStatus::Decided)
            ->and(User::query()->findOrFail($case->subject_id)->restrictions['messaging']['decision_id'] ?? null)->toBe($decision->id)
            ->and(AuditEvent::query()->where('action', 'moderation.decided')->exists())->toBeTrue();
    });

    it('marks automated detection for a case a keyword rule opened, and never automated decision', function () {
        adm34Rule('Rabattcode', KeywordList::Flag);
        $member = User::factory()->create();
        app(UpdateProfile::class)->handle($member, ['bio' => 'Rabattcode hier']);
        $case = ModerationCase::query()->where('target_id', $member->id)->sole();
        adm34As('moderator');

        $this->post("/admin/moderation/cases/{$case->id}/decide", adm34Decision('remove_content'))->assertSessionHas('success');
        $decision = Decision::query()->where('case_id', $case->id)->sole();
        expect($decision->automatedDetection())->toBeTrue()->and($decision->automatedDecision())->toBeFalse();
    });

    it('turns a suspension into a pending approval and changes nothing', function () {
        $case = adm34VehicleCase();
        adm34As('moderator');

        $this->post("/admin/moderation/cases/{$case->id}/decide", adm34Decision('suspend', ['until' => now()->addDays(10)->toIso8601String()]))->assertSessionHas('approval');

        $request = ApprovalRequest::query()->sole();
        expect($request->action)->toBe('moderation.suspend')
            ->and($request->status)->toBe(ApprovalStatus::Pending)
            ->and($request->payload['case_id'])->toBe($case->id)
            ->and(Decision::query()->count())->toBe(0)
            ->and($case->refresh()->status->isOpen())->toBeTrue()
            ->and(User::query()->findOrFail($case->subject_id)->isSuspended())->toBeFalse();

        $approver = staffWithRole('admin');
        app(Approvals::class)->approve($request, $approver);
        expect(Decision::query()->where('case_id', $case->id)->sole()->action)->toBe(DecisionAction::Suspend);
    });

    it('caps a moderator suspension at 30 days', function () {
        $case = adm34VehicleCase();
        adm34As('moderator');
        $this->post("/admin/moderation/cases/{$case->id}/decide", adm34Decision('suspend'))->assertSessionHasErrors('until');
        expect(ApprovalRequest::query()->count())->toBe(0);
    });

    it('needs moderation.messages for a message case, also with moderation.decide', function () {
        [$case] = adm34MessageCase();
        seedStaffRoles();
        $staff = staffWithRole(null);
        $staff->givePermissionTo(['moderation.view', 'moderation.decide']);
        actingAsStaff($staff->fresh() ?? $staff);
        $this->withSession(['auth.password_confirmed_at' => time()]);

        assertAdminErrorPage($this->post("/admin/moderation/cases/{$case->id}/decide", adm34Decision('no_action')), 403);
        expect(Decision::query()->count())->toBe(0);
    });

    it('takes and hands over a case', function () {
        $case = adm34VehicleCase();
        $staff = adm34As('moderator');
        $this->post("/admin/moderation/cases/{$case->id}/assign")->assertSessionHas('success', 'moderation.flash.taken');
        expect($case->refresh()->assigned_staff_id)->toBe($staff->id)->and($case->status)->toBe(CaseStatus::InReview);

        $colleague = staffWithRole('admin');
        $this->post("/admin/moderation/cases/{$case->id}/assign", ['staff_id' => $colleague->id])->assertSessionHas('success', 'moderation.flash.reassigned');
        expect($case->refresh()->assigned_staff_id)->toBe($colleague->id)
            ->and(AuditEvent::query()->where('action', 'moderation.case_assigned')->count())->toBe(2);

        $this->post("/admin/moderation/cases/{$case->id}/assign", ['staff_id' => staffWithRole('support')->id])->assertSessionHasErrors('staff_id');
    });

    it('renders the member SAFE-01 text in German and English', function () {
        $case = adm34VehicleCase();
        adm34As('moderator');
        $answer = $this->postJson("/admin/moderation/cases/{$case->id}/preview", ['action' => 'restrict', 'restriction' => 'publishing', 'until' => now()->addDays(7)->toIso8601String(), 'facts' => 'Wiederholte Werbung für einen Shop.', 'ground' => 'Keine Werbung'])
            ->assertOk()->assertHeader('Cache-Control', 'no-store, private')->json();

        expect(implode("\n", $answer['de']))->toContain('Sachverhalt: Wiederholte Werbung für einen Shop.')->toContain('Einspruch')->toContain('Streitbeilegung')
            ->and(implode("\n", $answer['en']))->toContain('Facts: Wiederholte Werbung für einen Shop.')->toContain('court');
    });

    it('counts the appeal deadline of the preview from ?qaNow= (QaClock), else from now (DQ-700)', function () {
        $case = adm34VehicleCase();
        adm34As('moderator');
        $body = ['action' => 'remove_content', 'facts' => 'Ein Produktfoto aus einem Shop.', 'ground' => 'Community-Richtlinien § 4'];
        $preview = fn (string $query): string => implode("\n", $this->postJson("/admin/moderation/cases/{$case->id}/preview{$query}", $body)->assertOk()->json('de'));
        app()->setLocale('de');
        $line = fn (string $from): string => ModerationText::withDeadline('moderation.mail.decision.redress.internal_complaint', AppealDeadline::from(CarbonImmutable::parse($from)));

        $this->travelTo(CarbonImmutable::parse('2026-12-20 09:00:00'));
        expect($preview('?qaNow=2026-11-02T10:00:00Z'))->toContain($line('2026-11-02T10:00:00Z'))
            ->and($preview(''))->toContain($line('2026-12-20 09:00:00'))->not->toContain($line('2026-11-02T10:00:00Z'));
    });
});

describe('appeals', function () {
    beforeEach(function () {
        $this->decider = null;
        seedStaffRoles();
        $this->decider = staffWithRole('moderator');
        $case = adm34VehicleCase();
        actingAsStaff($this->decider);
        $this->withSession(['auth.password_confirmed_at' => time()]);
        $this->post("/admin/moderation/cases/{$case->id}/decide", adm34Decision('remove_content'));
        $this->decision = Decision::query()->where('case_id', $case->id)->sole();
        $this->member = User::query()->findOrFail($this->decision->subject_id);
        $this->appeal = app(FileAppeal::class)->handle($this->member, $this->decision, DecisionViewer::Affected, 'Das Fahrzeug gehört mir, die Fotos sind von mir.');
    });

    it('refuses the staff member who took the decision', function () {
        assertAdminErrorPage($this->post("/admin/moderation/appeals/{$this->appeal->id}/decide", ['outcome' => 'upheld', 'explanation' => 'Die Entscheidung bleibt bestehen.', 'reason' => adm32Reason()]), 403);
        expect($this->appeal->refresh()->status)->toBe(AppealStatus::Open);
    });

    it('lets another staff member uphold it and tells the appellant', function () {
        $other = staffWithRole('admin');
        app('auth')->forgetGuards();
        actingAsStaff($other);
        $this->withSession(['auth.password_confirmed_at' => time()]);

        $this->post("/admin/moderation/appeals/{$this->appeal->id}/decide", ['outcome' => 'upheld', 'explanation' => 'Die Fotos stammen aus einem Shop-Katalog.', 'reason' => adm32Reason()])->assertSessionHas('success', 'moderation.flash.appeal_decided');

        expect($this->appeal->refresh()->status)->toBe(AppealStatus::Upheld)
            ->and($this->appeal->decided_by)->toBe($other->id)
            ->and(Notification::query()->where('notifiable_id', $this->member->id)->where('type', NotificationType::ModerationDecision->value)->count())->toBe(2)
            ->and(AuditEvent::query()->where('action', 'moderation.appeal_decided')->exists())->toBeTrue();
        Queue::assertPushed(SendAppealOutcomeMail::class);
    });

    it('reverses the decision when another staff member overturns it, and tells the reporters', function () {
        $other = staffWithRole('admin');
        app('auth')->forgetGuards();
        actingAsStaff($other);
        $this->withSession(['auth.password_confirmed_at' => time()]);
        $reporter = Report::query()->where('case_id', $this->decision->case_id)->value('reporter_id');

        $this->post("/admin/moderation/appeals/{$this->appeal->id}/decide", ['outcome' => 'reversed', 'explanation' => 'Die Fotos sind vom eigenen Auto, das ist belegt.', 'reason' => adm32Reason()])->assertSessionHas('success');

        $reversal = Decision::query()->where('reverses_decision_id', $this->decision->id)->sole();
        expect($this->appeal->refresh()->status)->toBe(AppealStatus::Reversed)
            ->and($reversal->action)->toBe(DecisionAction::Reverse)
            ->and(ModerationCase::query()->findOrFail($reversal->case_id)->appeal_id)->toBe($this->appeal->id)
            ->and(Notification::query()->where('notifiable_id', $reporter)->where('type', NotificationType::ReportDecided->value)->where('data->decision_id', $reversal->id)->exists())->toBeTrue()
            ->and(app(DecisionAudience::class)->roleOf(User::query()->findOrFail($reporter), $reversal))->toBe(DecisionViewer::Reporter);
    });
});

describe('evidence and message content', function () {
    it('shows evidence only through the audited JSON answer, never in props', function () {
        [$case] = adm34MessageCase();
        adm34As('moderator');

        $page = $this->get("/admin/moderation/cases/{$case->id}")->assertOk();
        expect((string) $page->getContent())->not->toContain('Supermarktparkplatz');
        $page->assertInertia(fn (AssertableInertia $p) => $p->where('preview', null)->where('messageCase', true));

        $this->withHeader('X-Inertia', 'true')->postJson("/admin/moderation/cases/{$case->id}/evidence")->assertStatus(409);
        $evidence = $this->withoutHeader('X-Inertia')->postJson("/admin/moderation/cases/{$case->id}/evidence")->assertOk()->assertHeader('Cache-Control', 'no-store, private')->json();

        $bodies = array_column($evidence['reports'][0]['messages'], 'body');
        expect($bodies)->toContain('Bleib lieber auf dem Supermarktparkplatz, du Lusche.')->toContain('Na, fährst du den FK8 selbst?')
            ->and($evidence['participants'])->toBe(['reported' => 'marco.adm34', 'reporter' => 'aylin.adm34'])
            ->and(AuditEvent::query()->where('action', 'moderation.evidence_viewed')->count())->toBe(1);

        $live = $this->postJson("/admin/moderation/cases/{$case->id}/live-context")->assertOk()->json('messages');
        expect(count($live))->toBe(3)->and(AuditEvent::query()->where('action', 'moderation.live_context_viewed')->count())->toBe(1);
    });

    it('lets the analyst see cases but never message content', function () {
        [$case] = adm34MessageCase();
        adm34As('analyst');

        $queue = $this->get('/admin/moderation/reports')->assertOk();
        expect((string) $queue->getContent())->not->toContain('Supermarktparkplatz')->not->toContain('Beleidigt mich');
        $page = $this->get("/admin/moderation/cases/{$case->id}")->assertOk();
        expect((string) $page->getContent())->not->toContain('Supermarktparkplatz')->not->toContain('Beleidigt mich')
            ->and(adm34Keys($page->viewData('page')['props']))->not->toContain('body');

        $this->postJson("/admin/moderation/cases/{$case->id}/evidence")->assertForbidden();
        $this->postJson("/admin/moderation/cases/{$case->id}/live-context")->assertForbidden();
        assertAdminErrorPage($this->get('/admin/moderation/messages'), 403);
        expect(AuditEvent::query()->where('action', 'moderation.evidence_viewed')->count())->toBe(0);

        $vehicle = adm34VehicleCase();
        $this->postJson("/admin/moderation/cases/{$vehicle->id}/evidence")->assertOk();
    });

    it('keeps message content off the ADM-22 page until the case is opened through the JSON answer', function () {
        [$case] = adm34MessageCase();
        adm34As('moderator');
        $page = $this->get("/admin/moderation/messages?case={$case->id}")->assertOk();
        expect((string) $page->getContent())->not->toContain('Supermarktparkplatz');
        $page->assertInertia(fn (AssertableInertia $p) => $p->component('Moderation/Messages')->where('selected.case.id', $case->id));
    });
});

describe('bulk no action', function () {
    it('closes up to 100 cases at once and tells the reporters the outcome', function () {
        $cases = [adm34VehicleCase(), adm34VehicleCase(), adm34VehicleCase()];
        adm34As('moderator');
        $this->post('/admin/moderation/reports/bulk', ['action' => 'no_action', 'ids' => array_map(fn ($c) => $c->id, $cases), 'reason' => adm32Reason()])->assertSessionHas('moderation_bulk');
        expect(Decision::query()->where('action', DecisionAction::NoAction->value)->count())->toBe(3)
            ->and(AuditEvent::query()->where('action', 'moderation.bulk_no_action')->count())->toBe(1)
            ->and(Notification::query()->where('type', NotificationType::ReportDecided->value)->count())->toBe(3);
    });

    it('asks for an approval once the rolling 24 hours pass 100 cases, and changes nothing', function () {
        $case = adm34VehicleCase();
        $staff = adm34As('moderator');
        DB::transaction(fn () => Audit::record('moderation.bulk_no_action', null, after: ['records' => 100, 'done' => 100, 'failed' => 0, 'requested_by' => $staff->id, 'approved_by' => null], reason: adm32Reason(), actor: $staff));

        $this->post('/admin/moderation/reports/bulk', ['action' => 'no_action', 'ids' => [$case->id], 'reason' => adm32Reason()])->assertSessionHas('approval');
        expect(ApprovalRequest::query()->sole()->action)->toBe('moderation.bulk_no_action')->and(Decision::query()->count())->toBe(0);
    });
});

describe('rules', function () {
    it('adds and removes a term with a reason, refusing a duplicate normal form', function () {
        adm34As('moderator');
        $this->post('/admin/moderation/rules', ['term' => 'Rabatt-Code', 'list' => 'flag', 'reason' => adm32Reason()])->assertSessionHas('success');
        $this->post('/admin/moderation/rules', ['term' => 'RABATT CODE', 'list' => 'block', 'reason' => adm32Reason()])->assertSessionHasErrors('term');
        $rule = KeywordRule::query()->sole();
        $this->delete("/admin/moderation/rules/{$rule->id}", ['reason' => adm32Reason()])->assertSessionHas('success');
        expect(KeywordRule::query()->count())->toBe(0)
            ->and(AuditEvent::query()->whereIn('action', ['moderation.keyword_added', 'moderation.keyword_removed'])->count())->toBe(2);
    });

    it('publishes rate-limit overrides within 0.25× to 4× and refuses others', function () {
        adm34As('moderator');
        // reports: 20 a day by default → 5…80.
        $this->post('/admin/moderation/rules/rate-limits', ['overrides' => ['reports' => 81], 'reason' => adm32Reason()])->assertSessionHasErrors('overrides.reports');
        $this->post('/admin/moderation/rules/rate-limits', ['overrides' => ['reports' => 4], 'reason' => adm32Reason()])->assertSessionHasErrors('overrides.reports');
        $this->post('/admin/moderation/rules/rate-limits', ['overrides' => ['staff_password_reset' => 6], 'reason' => adm32Reason()])->assertSessionHasErrors('overrides');
        expect(ConfigVersion::query()->where('key', 'rate_limits')->count())->toBe(0);

        $this->post('/admin/moderation/rules/rate-limits', ['overrides' => ['reports' => 40, 'messages' => null], 'reason' => adm32Reason()])->assertSessionHas('success');
        expect(ConfigVersion::query()->where('key', 'rate_limits')->sole()->payload['overrides'])->toBe(['reports' => 40])
            ->and(Cache::get(RateLimitOverrides::CACHE_KEY))->toBe(['reports' => 40])
            ->and(AuditEvent::query()->where('action', 'moderation.rate_limits_published')->exists())->toBeTrue();

        // Applied at boot from the cache.
        RateLimits::register();
        $request = Request::create('/api/v1/reports', 'POST');
        $limits = RateLimiter::limiter('reports')($request);
        expect(is_array($limits) ? $limits[0]->maxAttempts : $limits->maxAttempts)->toBe(40);
    });

    it('bounds a stored override again when it is read', function () {
        Cache::forever(RateLimitOverrides::CACHE_KEY, ['reports' => 1000, 'messages' => 1]);
        // A stored value is read by the next process (the overrides are memoised per process, MF-2): start one.
        RateLimitOverrides::flush();
        expect(RateLimitOverrides::maxFor('reports', 20))->toBe(80)->and(RateLimitOverrides::maxFor('messages', 30))->toBe(8)->and(RateLimitOverrides::maxFor('uploads', 60))->toBeNull();
    });
});

describe('templates', function () {
    it('saves, refuses a second template of the same key and language, and deletes', function () {
        adm34As('moderator');
        $data = ['key' => 'werkstatt', 'locale' => 'de', 'action' => 'remove_content', 'label' => 'Werkstatt-Werbung', 'facts' => 'Der Inhalt {target} wirbt für eine Werkstatt.', 'ground' => 'Keine Werbung', 'ground_document' => 'community', 'ground_section' => '4'];
        $this->post('/admin/moderation/templates', $data)->assertSessionHas('success');
        $this->post('/admin/moderation/templates', $data)->assertSessionHasErrors('key');
        $template = SorTemplate::query()->where('key', 'werkstatt')->sole();
        $this->delete("/admin/moderation/templates/{$template->id}")->assertSessionHas('success');
        expect(SorTemplate::query()->where('key', 'werkstatt')->exists())->toBeFalse()
            ->and(AuditEvent::query()->whereIn('action', ['moderation.template_saved', 'moderation.template_deleted'])->count())->toBe(2);
    });

    it('ships the default templates in German and English', function () {
        expect(SorTemplate::query()->where('locale', 'de')->count())->toBe(SorTemplate::query()->where('locale', 'en')->count())
            ->and(SorTemplate::query()->count())->toBeGreaterThanOrEqual(10);
    });
});

describe('ADM-08 and the queue', function () {
    it('lists my approved requests still executing on ADM-08', function () {
        $staff = adm34As('admin');
        $request = new ApprovalRequest;
        $request->forceFill([
            'action' => 'members.bulk', 'payload' => ['ids' => []], 'summary' => ['title' => 'approvals.members_bulk.title', 'subject_label' => null, 'lines' => []],
            'reason' => adm32Reason(), 'requested_by' => $staff->id, 'status' => ApprovalStatus::Executing, 'decided_by' => staffWithRole('owner')->id,
            'decided_at' => now(), 'expires_at' => now()->addDay(),
        ])->save();

        $this->get('/admin/alerts')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->where('running.0.id', $request->id)->where('running.0.mine', true));
    });

    it('sorts the queue by the priority sum, not the stored base, and names its parts', function () {
        // Same reason weight (spam, 10); the second member had a content removal before: repeat +5 puts that case first.
        $plain = adm34VehicleCase();
        $repeat = adm34VehicleCase();
        $earlier = modCaseOf(modReport(User::factory()->create(), ReportTargetType::Vehicle, modVehicle(User::query()->findOrFail($repeat->subject_id))->id));
        modDecide($earlier, DecisionAction::RemoveContent);
        adm34As('moderator');

        $this->get('/admin/moderation/reports')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p
            ->where('rows.data.0.id', $repeat->id)
            ->where('rows.data.0.priority.reason', 10)
            ->where('rows.data.0.priority.repeat', 5)
            ->where('rows.data.0.priority.repeat_count', 1)
            ->where('rows.data.1.id', $plain->id)
            ->where('rows.data.1.priority.repeat', 0)
            ->has('rows.data.0.priority.age'));
        $this->get('/admin/moderation/reports?sort=priority')->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->where('rows.data.0.id', $plain->id));
    });
});

describe('ADR-232 and the enrolment QR', function () {
    it('refuses every admin list CSV to the analyst', function () {
        $csv = collect(app('router')->getRoutes()->getRoutes())->filter(fn ($route) => str_starts_with($route->uri(), 'admin/') && str_ends_with($route->uri(), '.csv') && in_array('GET', $route->methods(), true));
        expect($csv->count())->toBeGreaterThan(0);
        adm34As('analyst');

        foreach ($csv as $route) {
            $uri = '/'.preg_replace('/\{[^}]+\}/', 'x', $route->uri());
            expect($this->get($uri)->status())->toBe(403, $uri);
        }
    });

    it('draws the TOTP enrolment QR black on white', function () {
        $staff = Staff::factory()->create();
        $staff->forceFill(['two_factor_secret' => encrypt('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')])->save();
        $svg = $staff->twoFactorQrCodeSvg();
        preg_match_all('/fill="([^"]+)"/', $svg, $fills);
        expect(array_values(array_unique($fills[1])))->toEqualCanonicalizing(['#ffffff', '#000000'])->and($svg)->toStartWith('<svg');
    });
});
