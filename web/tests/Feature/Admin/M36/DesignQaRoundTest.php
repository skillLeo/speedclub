<?php

use App\Enums\PrivacyRequestStatus;
use App\Enums\PrivacyRequestType;
use App\Models\Entitlement;
use App\Models\PrivacyRequest;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * M3.6 design-QA round (2026-11-09 report): one clock for the GDPR deadlines (DQ-617), the reply address and why no reply can be sent
 * (DQ-618), open requests before completed ones (DQ-636), ADM-48 reasons, "nicht eingerichtet" and the "was tun" links (DQ-620/638), and
 * the entitlement status read by the server.
 */
beforeEach(function () {
    Mail::fake();
    Queue::fake();
});

describe('DQ-617 one clock for the GDPR deadlines', function () {
    it('reads the deadline states, counts and filters with the page clock (?qaNow outside production)', function () {
        adm36As('admin');
        $frozen = CarbonImmutable::parse('2026-11-02T10:00:00Z');
        $soon = PrivacyRequest::factory()->create(['received_at' => $frozen->subMonth(), 'due_at' => $frozen->addDays(2)]);
        $later = PrivacyRequest::factory()->create(['received_at' => $frozen->subDays(4), 'due_at' => $frozen->addDays(26)]);

        // At the frozen day: due in 2 days (amber) and in 26 days; nothing overdue.
        $this->get('/admin/privacy/requests?qaNow=2026-11-02T10:00:00.000Z')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('counts.due_soon', 1)->where('counts.overdue', 0)
            ->where('rows.data', fn ($rows) => collect($rows)->firstWhere('id', $soon->id)['due'] === ['state' => 'soon', 'days' => 2]
                && collect($rows)->firstWhere('id', $later->id)['due'] === ['state' => 'later', 'days' => 26]));
        $this->get('/admin/privacy/requests?qaNow=2026-11-02T10:00:00.000Z&filter[due]=overdue')->assertInertia(fn (AssertableInertia $p) => $p->where('rows.meta.total', 0));

        // A week later the same rows read overdue (5 days) and due in 19 days, with the counts to match.
        $this->get('/admin/privacy/requests?qaNow=2026-11-09T10:00:00.000Z')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('counts.due_soon', 0)->where('counts.overdue', 1)
            ->where('rows.data', fn ($rows) => collect($rows)->firstWhere('id', $soon->id)['due'] === ['state' => 'overdue', 'days' => 5]));

        // ADM-46: the extension is offered while the deadline is ahead of the page's clock, with the server-computed new date.
        $this->get("/admin/privacy/requests/{$soon->id}?qaNow=2026-11-02T10:00:00.000Z")->assertInertia(fn (AssertableInertia $p) => $p
            ->where('can.extend', true)->where('request.due', ['state' => 'soon', 'days' => 2])
            ->where('request.extended_due_at', fn ($at) => CarbonImmutable::parse((string) $at)->isSameDay($frozen->addDays(2)->addMonthsNoOverflow(2))));
        $this->get("/admin/privacy/requests/{$soon->id}?qaNow=2026-11-09T10:00:00.000Z")->assertInertia(fn (AssertableInertia $p) => $p->where('can.extend', false));
    });

    it('never moves the real deadline rule: the extension itself checks the real time', function () {
        adm36As('admin');
        $past = PrivacyRequest::factory()->create(['received_at' => now()->subMonths(2), 'due_at' => now()->subDay()]);

        $this->post("/admin/privacy/requests/{$past->id}/extend?qaNow=".urlencode(now()->subWeek()->toIso8601String()), ['reason' => 'Identität noch nicht nachgewiesen.'])
            ->assertSessionHas('error');
        expect($past->fresh()->extended_at)->toBeNull();
    });

    it('ignores ?qaNow in production', function () {
        adm36As('admin');
        $request = PrivacyRequest::factory()->create(['received_at' => now()->subMonths(2), 'due_at' => now()->subDays(3)]);
        app()->detectEnvironment(fn () => 'production');

        $this->get("/admin/privacy/requests/{$request->id}?qaNow=".urlencode(now()->subWeek()->toIso8601String()))
            ->assertInertia(fn (AssertableInertia $p) => $p->where('request.due.state', 'overdue')->where('can.extend', false));
    });
});

describe('DQ-636 open requests first', function () {
    it('sorts open, in-progress and waiting requests by due date above the completed and rejected ones', function () {
        adm36As('admin');
        $done = PrivacyRequest::factory()->create(['status' => PrivacyRequestStatus::Completed, 'completed_at' => now(), 'due_at' => now()->subDays(20)]);
        $rejected = PrivacyRequest::factory()->create(['status' => PrivacyRequestStatus::Rejected, 'completed_at' => now(), 'due_at' => now()->subDays(30)]);
        $late = PrivacyRequest::factory()->create(['status' => PrivacyRequestStatus::Waiting, 'due_at' => now()->addDays(20)]);
        $early = PrivacyRequest::factory()->create(['due_at' => now()->subDays(13)]);

        $ids = fn ($rows) => array_column($rows, 'id');
        $this->get('/admin/privacy/requests')->assertInertia(fn (AssertableInertia $p) => $p->where('rows.data', fn ($rows) => $ids(collect($rows)->all()) === [$early->id, $late->id, $rejected->id, $done->id]));
        $this->get('/admin/privacy/requests?sort=-due_at')->assertInertia(fn (AssertableInertia $p) => $p->where('rows.data', fn ($rows) => $ids(collect($rows)->all()) === [$late->id, $early->id, $done->id, $rejected->id]));
        $this->get('/admin/privacy/requests')->assertInertia(fn (AssertableInertia $p) => $p->where('rows.data.3.due', ['state' => 'done', 'days' => 0]));
    });
});

describe('DQ-618 reply address', function () {
    it('shows a member\'s account address masked and offers the reply', function () {
        $member = User::factory()->create(['email' => 'lukas.schneider@beispiel.test']);
        $request = PrivacyRequest::factory()->create(['type' => PrivacyRequestType::Access, 'user_id' => $member->id, 'requester_email' => null]);
        adm36As('owner');

        $response = $this->get("/admin/privacy/requests/{$request->id}")->assertInertia(fn (AssertableInertia $p) => $p
            ->where('can.reply', true)->where('can.reply_blocked', null)
            ->where('request.reply_to', fn ($masked) => is_string($masked) && $masked !== '' && ! str_contains($masked, 'lukas.schneider')));

        expect(adm36PropsJson($response))->not->toContain('lukas.schneider@beispiel.test');
    });

    it('says why no reply can be sent: the permission, an external requester without address, a member without one', function () {
        $external = PrivacyRequest::factory()->create(['user_id' => null, 'requester_email' => null, 'requester_name' => 'Thomas Berger']);
        $member = User::factory()->create();
        $member->forceFill(['email' => ''])->save();
        $noAddress = PrivacyRequest::factory()->create(['user_id' => $member->id, 'requester_email' => null]);
        $withAddress = PrivacyRequest::factory()->create(['requester_email' => 'anfrage@beispiel.test']);

        adm36As('owner');
        $this->get("/admin/privacy/requests/{$external->id}")->assertInertia(fn (AssertableInertia $p) => $p->where('can.reply', false)->where('can.reply_blocked', 'no_address')->where('request.reply_to', null));
        $this->get("/admin/privacy/requests/{$noAddress->id}")->assertInertia(fn (AssertableInertia $p) => $p->where('can.reply', false)->where('can.reply_blocked', 'no_member_address'));

        adm36As('support');
        $this->get("/admin/privacy/requests/{$withAddress->id}")->assertInertia(fn (AssertableInertia $p) => $p->where('can.reply', false)->where('can.reply_blocked', 'permission'));
    });
});

describe('DQ-620/638 ADM-48 board', function () {
    it('reads the stored run as reasons, "nicht eingerichtet" for the log mailer and no AI provider, counts and "was tun" links', function () {
        config(['mail.default' => 'log', 'speedclub.services.ai_provider' => null, 'broadcasting.default' => 'log']);
        adm36As('admin');
        $this->post('/admin/system/health/run')->assertRedirect();

        $response = $this->get('/admin/system/health')->assertInertia(fn (AssertableInertia $p) => $p->component('System/Health')
            ->where('report.checks', function ($checks) {
                $by = collect($checks)->keyBy('name');

                return $by['MailConfig']['status'] === 'not_configured' && $by['MailConfig']['reason'] === ['key' => 'mail_log', 'params' => ['driver' => 'log']]
                    && str_ends_with((string) $by['MailConfig']['todo']['href'], '/admin/system/integrations')
                    && $by['AiProvider']['status'] === 'not_configured' && $by['AiProvider']['reason'] === ['key' => 'ai_none']
                    && $by['Pusher']['status'] === 'not_configured'
                    && $by['FailedJobs']['reason'] === ['key' => 'failed_jobs', 'count' => 0]
                    && collect($checks)->every(fn ($c) => ! array_key_exists('meta', $c) && ! array_key_exists('summary', $c));
            })
            ->where('report.counts', fn ($counts) => $counts['not_configured'] >= 3 && array_sum(collect($counts)->all()) >= 15));

        // The checks' English messages never reach the page.
        expect(adm36PropsJson($response))->not->toContain('% used.')->not->toContain('failed jobs.')->not->toContain('The schedule did not run');
    });

    it('turns a failing check into its German reason with a link to the jobs', function () {
        adm36FailedJobs(3);
        adm36As('admin');
        $this->post('/admin/system/health/run')->assertRedirect();

        $this->get('/admin/system/health')->assertInertia(fn (AssertableInertia $p) => $p
            ->where('report.status', fn ($status) => in_array($status, ['warning', 'failed'], true))
            ->where('report.checks', fn ($checks) => ($failed = collect($checks)->firstWhere('name', 'FailedJobs')) !== null
                && $failed['status'] === 'warning' && $failed['reason'] === ['key' => 'failed_jobs', 'count' => 3]
                && str_ends_with((string) $failed['todo']['href'], '/admin/system/jobs')));
    });
});

describe('ADM-F2 status from the server', function () {
    it('reads aktiv, geplant and abgelaufen with the page clock', function () {
        adm36Premium();
        $entitlement = Entitlement::factory()->create(['starts_at' => CarbonImmutable::parse('2026-11-05T00:00:00Z'), 'ends_at' => CarbonImmutable::parse('2026-11-20T00:00:00Z')]);
        adm36As('admin');

        $status = fn (string $at) => $this->get('/admin/memberships/entitlements?qaNow='.$at)->assertInertia(fn (AssertableInertia $p) => $p->where('entitlements.0.id', $entitlement->id))->viewData('page')['props']['entitlements'][0]['status'];

        expect($status('2026-11-02T10:00:00Z'))->toBe('scheduled')
            ->and($status('2026-11-09T10:00:00Z'))->toBe('active')
            ->and($status('2026-11-21T10:00:00Z'))->toBe('ended');
    });
});

function adm36FailedJobs(int $count): void
{
    foreach (range(1, $count) as $n) {
        DB::table('failed_jobs')->insert([
            'uuid' => (string) Str::uuid(),
            'connection' => 'database',
            'queue' => 'default',
            'payload' => json_encode(['displayName' => 'App\\Jobs\\BuildDataExport']),
            'exception' => 'RuntimeException: Timeout.',
            'failed_at' => now()->subMinutes($n),
        ]);
    }
}
