<?php

use App\Enums\ApprovalStatus;
use App\Models\ApprovalRequest;
use App\Models\User;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\HandlerRegistry;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/Helpers.php';

/*
 * ADM-43 approvals queue (ADR-214): tabs per role, approve / deny / cancel over HTTP with the engine's rules (requester ≠ approver,
 * atoms, recent password), summaries translated (SF-1: every key a handler's describe() uses exists in both locales).
 */
beforeEach(fn () => Mail::fake());

function adm32Pending(string $role = 'support'): ApprovalRequest
{
    $member = User::factory()->create(['username' => 'anna.q']);
    $requester = staffWithRole('owner');

    return app(Approvals::class)->request('members.export', ['member_id' => $member->id], adm32Reason(), $requester, $member);
}

describe('authorisation', function () {
    it('opens for every staff member with TOTP', function () {
        assertAdminMatrix('GET', '/admin/team/approvals', ['owner', 'admin', 'moderator', 'support', 'content_editor', 'analyst'], fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $p) => $p->component('Approvals/Index')));
    });

    it('lets only approvals.decide approve and deny', function (string $kind) {
        seedStaffRoles();
        $request = adm32Pending();
        adm32WriteMatrix('POST', '/admin/team/approvals/'.$request->id.'/'.$kind, ['owner', 'admin'], ['comment' => 'Geprüft, passt.']);
    })->with(['approve', 'deny']);
});

describe('tabs', function () {
    it('shows Für mich and Alle to Owner/Admin, only Von mir to others', function () {
        seedStaffRoles();
        adm32Pending();

        adm32SignedIn('admin');
        $this->get('/admin/team/approvals')->assertInertia(fn (AssertableInertia $p) => $p->where('tab', 'for_me')->where('canSeeAll', true)->has('requests', 1)
            ->where('requests.0.can_decide', true)->where('requests.0.title', 'approvals.members_export.title')->has('requests.0.lines', 1)->missing('requests.0.payload'));

        adm32SignedIn('support');
        $this->get('/admin/team/approvals?tab=all')->assertInertia(fn (AssertableInertia $p) => $p->where('tab', 'mine')->where('canDecide', false)->has('requests', 0));
    });

    it('never offers the requester their own request to decide, only to withdraw', function () {
        seedStaffRoles();
        $requester = staffWithRole('owner');
        $member = User::factory()->create();
        app(Approvals::class)->request('members.export', ['member_id' => $member->id], adm32Reason(), $requester, $member);
        actingAsStaff($requester);

        $this->get('/admin/team/approvals?tab=for_me')->assertInertia(fn (AssertableInertia $p) => $p->has('requests', 0));
        $this->get('/admin/team/approvals?tab=mine')->assertInertia(fn (AssertableInertia $p) => $p->where('requests.0.can_decide', false)->where('requests.0.can_cancel', true));
    });
});

describe('decisions', function () {
    it('approves through the engine with a fresh password, and the requester cannot approve their own', function () {
        seedStaffRoles();
        $request = adm32Pending();

        $approver = adm32SignedIn('admin');
        $this->from('/admin/team/approvals')->post('/admin/team/approvals/'.$request->id.'/approve', ['comment' => 'Geprüft, passt.'])
            ->assertStatus(303)->assertSessionHas('success', 'approvals.flash.approved');

        expect($request->refresh()->status)->toBe(ApprovalStatus::Executed)->and($request->decided_by)->toBe($approver->id);

        $this->from('/admin/team/approvals')->post('/admin/team/approvals/'.$request->id.'/approve')->assertSessionHas('error', 'approvals.flash.conflict');
    });

    it('refuses the requester as approver (403) and leaves the request pending', function () {
        seedStaffRoles();
        $requester = staffWithRole('owner');
        $member = User::factory()->create();
        $request = app(Approvals::class)->request('members.export', ['member_id' => $member->id], adm32Reason(), $requester, $member);
        actingAsStaff($requester);
        $this->withSession(['auth.password_confirmed_at' => time()]);

        assertAdminErrorPage($this->post('/admin/team/approvals/'.$request->id.'/approve'), 403);
        expect($request->refresh()->status)->toBe(ApprovalStatus::Pending);
    });

    it('needs a comment to deny, and a recent password', function () {
        seedStaffRoles();
        $request = adm32Pending();
        adm32SignedIn('owner');

        $this->from('/admin/team/approvals')->post('/admin/team/approvals/'.$request->id.'/deny', ['comment' => ''])->assertSessionHasErrors('comment');

        $this->withSession(['auth.password_confirmed_at' => time() - 301]);
        $this->from('/admin/team/approvals')->post('/admin/team/approvals/'.$request->id.'/deny', ['comment' => 'Kein Anlass erkennbar.'])->assertSessionHas('confirm_password', true);
        expect($request->refresh()->status)->toBe(ApprovalStatus::Pending);

        $this->withSession(['auth.password_confirmed_at' => time()]);
        $this->from('/admin/team/approvals')->post('/admin/team/approvals/'.$request->id.'/deny', ['comment' => 'Kein Anlass erkennbar.'])->assertSessionHas('success', 'approvals.flash.denied');
        expect($request->refresh()->status)->toBe(ApprovalStatus::Denied);
    });

    it('lets only the requester withdraw', function () {
        seedStaffRoles();
        $requester = staffWithRole('owner');
        $member = User::factory()->create();
        $request = app(Approvals::class)->request('members.export', ['member_id' => $member->id], adm32Reason(), $requester, $member);

        actingAsStaff(staffWithRole('admin'));
        assertAdminErrorPage($this->post('/admin/team/approvals/'.$request->id.'/cancel'), 403);

        actingAsStaff($requester);
        $this->from('/admin/team/approvals')->post('/admin/team/approvals/'.$request->id.'/cancel')->assertSessionHas('success', 'approvals.flash.cancelled');
        expect($request->refresh()->status)->toBe(ApprovalStatus::Cancelled);
    });
});

describe('SF-1 summary keys', function () {
    it('has every title and line label of every registered handler in both locales', function () {
        $keys = [];
        $handlers = app(HandlerRegistry::class)->all();
        expect($handlers)->not->toBeEmpty();

        // describe() only reads the payload; an empty one yields every label the handler can show.
        foreach ($handlers as $handler) {
            $summary = $handler->describe([]);
            $keys[] = $summary['title'];
            foreach ($summary['lines'] as $line) {
                $keys[] = $line['label'];
            }
        }

        // Lines a handler adds only for a long list of records (SEC-P3-08), and the status labels ADM-43 shows.
        $keys = [...$keys, 'approvals.members_bulk.more', 'approvals.vehicles_bulk_hide.more', ...array_map(fn ($s) => 'approvals.status.'.$s->value, ApprovalStatus::cases())];

        foreach (['de', 'en'] as $locale) {
            $json = json_decode((string) file_get_contents(lang_path("admin/$locale/approvals.json")), true);
            foreach (array_unique($keys) as $key) {
                expect(str_starts_with($key, 'approvals.'))->toBeTrue("$key is not an approvals.* key");
                $value = data_get($json, substr($key, strlen('approvals.')));
                expect($value)->toBeString("$key is missing in $locale");
            }
        }
    });
});
