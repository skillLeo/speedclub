<?php

use App\Actions\Admin\Moderation\RevealReportContact;
use App\Enums\ReportSource;
use App\Models\AuditEvent;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\User;
use App\Services\Support\PiiReveals;
use Illuminate\Auth\Access\AuthorizationException;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/**
 * SEC-P3-25 (security round 3): a web-form notifier's address is masked in the ADM-21 props for everyone; a staff member with
 * moderation.view and members.view_pii reveals it with POST admin/moderation/cases/{case}/reports/{report}/contact: JSON only
 * (no-store), audited as `moderation.contact_viewed`, counted in the daily cap of address reveals (PiiReveals) and throttled.
 */
function sec25Case(): array
{
    $case = adm34VehicleCase();
    $report = Report::query()->where('case_id', $case->id)->firstOrFail();
    $report->forceFill(['source' => ReportSource::WebForm, 'reporter_id' => null, 'contact_name' => 'Jana Weber', 'contact_email' => 'jana.private@example.org'])->save();

    return [$case, $report];
}

function sec25Url(ModerationCase $case, Report $report): string
{
    return "/admin/moderation/cases/{$case->id}/reports/{$report->id}/contact";
}

it('masks the address in the page props for every role and offers the reveal only with members.view_pii', function (string $role, bool $canReveal) {
    [$case] = sec25Case();
    adm34As($role);

    $page = $this->get("/admin/moderation/cases/{$case->id}")->assertOk()->assertInertia(fn (AssertableInertia $p) => $p
        ->where('reports.0.contact.name', 'Jana Weber')
        ->where('reports.0.contact.email', fn (string $email) => ! str_contains($email, 'jana.private') && str_contains($email, '@'))
        ->where('reports.0.can_reveal_contact', $canReveal));

    expect(json_encode($page->viewData('page')))->not->toContain('jana.private@example.org')
        ->and(AuditEvent::query()->where('action', 'moderation.contact_viewed')->count())->toBe(0);
})->with([
    'owner' => ['owner', true],
    'admin' => ['admin', true],
    'moderator' => ['moderator', false],
]);

it('reveals the address to moderation.view + members.view_pii only, audited once per reveal', function (string $role, int $status) {
    [$case, $report] = sec25Case();
    $staff = adm34As($role);

    $response = $this->postJson(sec25Url($case, $report))->assertStatus($status);

    $events = AuditEvent::query()->where('action', 'moderation.contact_viewed');
    if ($status === 200) {
        $response->assertExactJson(['email' => 'jana.private@example.org']);
        expect($response->headers->get('Cache-Control'))->toContain('no-store');
        $event = $events->sole();
        expect($event->actor_id)->toBe((string) $staff->id)
            ->and($event->target_id)->toBe($case->id)
            ->and($event->after)->toEqualCanonicalizing(['report_id' => $report->id, 'fields' => ['email']]);
    } else {
        expect($events->count())->toBe(0)->and($response->getContent())->not->toContain('jana.private');
    }
})->with([
    'owner' => ['owner', 200],
    'admin' => ['admin', 200],
    'moderator (no members.view_pii)' => ['moderator', 403],
    'support (no moderation.view)' => ['support', 403],
    'content editor' => ['content_editor', 403],
    'analyst' => ['analyst', 403],
]);

it('refuses a signed-out visitor and a member session', function () {
    [$case, $report] = sec25Case();

    expect($this->postJson(sec25Url($case, $report))->status())->toBeIn([401, 403, 419]);

    $this->actingAs(User::factory()->create());
    expect($this->postJson(sec25Url($case, $report))->status())->toBeIn([401, 403, 419]);
    expect(AuditEvent::query()->where('action', 'moderation.contact_viewed')->count())->toBe(0);
});

it('refuses the Action itself without either atom', function (string $role) {
    [$case, $report] = sec25Case();

    expect(fn () => app(RevealReportContact::class)->handle(adm34As($role), $case, $report->id))->toThrow(AuthorizationException::class);
})->with(['moderator', 'support']);

it('finds only a web report of this case that has an address', function () {
    [$case, $report] = sec25Case();
    [$other] = sec25Case();
    $app = Report::factory()->create(['case_id' => $case->id, 'source' => ReportSource::App, 'contact_email' => null]);
    $nameOnly = Report::factory()->create(['case_id' => $case->id, 'source' => ReportSource::WebForm, 'reporter_id' => null, 'contact_name' => 'Ohne Adresse', 'contact_email' => null]);
    adm34As('admin');

    $this->postJson(sec25Url($other, $report))->assertNotFound();
    $this->postJson(sec25Url($case, $app))->assertNotFound();
    $this->postJson(sec25Url($case, $nameOnly))->assertNotFound();
    expect($this->postJson("/admin/moderation/cases/{$case->id}/reports/not-a-ulid/contact")->status())->toBeIn([404, 405]);
    $this->postJson("/admin/moderation/cases/01JAAAAAAAAAAAAAAAAAAAAAAA/reports/{$report->id}/contact")->assertNotFound();

    expect(AuditEvent::query()->where('action', 'moderation.contact_viewed')->count())->toBe(0);
});

it('never answers an Inertia visit (409)', function () {
    [$case, $report] = sec25Case();
    adm34As('admin');

    $this->withHeader('X-Inertia', 'true')->postJson(sec25Url($case, $report))->assertStatus(409);
    expect(AuditEvent::query()->where('action', 'moderation.contact_viewed')->count())->toBe(0);
});

it('counts in the shared daily cap of address reveals', function () {
    config(['speedclub.staff.pii_reveals_per_day' => 2]);
    [$case, $report] = sec25Case();
    $admin = adm34As('admin');
    $member = User::factory()->create();

    expect(PiiReveals::EVENTS)->toContain('moderation.contact_viewed');

    $this->postJson("/admin/members/{$member->id}/pii")->assertOk();
    $this->postJson(sec25Url($case, $report))->assertOk();
    $this->postJson(sec25Url($case, $report))->assertStatus(429)->assertJsonMissing(['email' => 'jana.private@example.org']);
    $this->postJson("/admin/members/{$member->id}/pii")->assertStatus(429);

    expect(AuditEvent::query()->where('action', 'moderation.contact_viewed')->count())->toBe(1)
        ->and(AuditEvent::query()->where('action', PiiReveals::LIMIT_EVENT)->where('actor_id', (string) $admin->id)->count())->toBe(1);
});

it('is throttled at 30 a minute', function () {
    [$case, $report] = sec25Case();
    adm34As('admin');

    for ($i = 0; $i < 30; $i++) {
        $this->postJson(sec25Url($case, $report))->assertOk();
    }

    $this->postJson(sec25Url($case, $report))->assertStatus(429);
    expect(AuditEvent::query()->where('action', 'moderation.contact_viewed')->count())->toBe(30);
});
