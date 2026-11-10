<?php

use App\Actions\Admin\Members\RequestMemberSuspension;
use App\Actions\Admin\Moderation\DecideAppeal;
use App\Actions\Admin\Support\AddTicketNote;
use App\Actions\Admin\Team\ApplyPermissionMatrix;
use App\Actions\Admin\Team\SaveRole;
use App\Actions\Moderation\FileAppeal;
use App\Actions\Support\CreateSupportTicket;
use App\Enums\AiFeature;
use App\Enums\AppealStatus;
use App\Enums\DataExportStatus;
use App\Enums\DecisionAction;
use App\Enums\DecisionViewer;
use App\Enums\KeywordList;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Enums\SupportCategory;
use App\Models\DataExport;
use App\Models\Decision;
use App\Models\Report;
use App\Models\Role;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Ai\Agents\TranslateAgent;
use App\Services\Approvals\Approvals;
use App\Services\DataExport\BuildDataExport;
use App\Services\Moderation\CaseEvidence;
use App\Services\Rules\KeywordNormaliser;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Admin/Actions/Helpers.php';
require_once __DIR__.'/../Admin/M34/Helpers.php';
require_once __DIR__.'/../Messaging/MessagingTestHelpers.php';
require_once __DIR__.'/../Settings/SettingsTestHelpers.php';
require_once __DIR__.'/../Ai/AiTestHelpers.php';

/**
 * Security review Phase 3, round 2 (docs/reports/security/phase-3.md §6.3): the new findings, written as the behaviour the fix must give.
 * Every case FAILS at e57550e; each turns green with its fix (SEC-P3-12 … -17). Land each case together with its fix.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    Storage::fake('local');
    Storage::fake(config()->string('speedclub.media.private_disk'));
});

it('SEC-P3-12: the member\'s own SET-12 export never carries the team\'s internal ticket notes', function () {
    $member = User::factory()->create(['locale' => 'de']);
    $ticket = app(CreateSupportTicket::class)->forMember($member, SupportCategory::cases()[0], 'Konto gesperrt?', 'Warum kann ich nicht schreiben?');
    app(AddTicketNote::class)->handle(m31Staff('support'), $ticket, 'INTERN: Verdacht auf Zweitkonto, Ex-Partnerin hat angerufen.');

    $export = new DataExport;
    $export->forceFill(['user_id' => $member->id, 'status' => DataExportStatus::Queued, 'requested_at' => now()])->save();
    BuildDataExport::dispatchSync($export->id);
    $entries = setReadZip($export->refresh());

    expect((string) $entries['support_tickets.json'])->toContain('Warum kann ich nicht schreiben?')->not->toContain('Zweitkonto');
});

it('SEC-P3-13: a sensitive grant is not applied to a different role renamed into the name the approval names', function () {
    $requester = m31Staff('admin');
    $save = app(SaveRole::class);
    $save->handle($requester, null, 'Helfer', null, ['qr.view', 'vehicles.view']);
    $holders = collect(range(1, 3))->map(fn () => tap(m31Staff('support'))->assignRole('Helfer'));
    $save->handle($requester, null, 'Neu', null, ['qr.view', 'vehicles.view']);
    $request = app(ApplyPermissionMatrix::class)->handle($requester, ['Neu' => ['members.export', 'qr.view', 'vehicles.view']], m32Reason())->approval;

    $neu = Role::query()->where('name', 'Neu')->sole();
    $helfer = Role::query()->where('name', 'Helfer')->sole();
    // The swap starts with renaming the role the pending approval names: refused with 409 role_pending_approval (ADR-251), and
    // the name stays taken, so the other role cannot move into it either. Any other error (a typo in SaveRole) fails this test.
    expect(fn () => $save->handle($requester, $neu, 'Neu-alt', null, ['qr.view', 'vehicles.view']))
        ->toThrow(fn (TeamRefused $refused) => expect($refused->reason)->toBe('role_pending_approval')->and($refused->status())->toBe(409));
    expect(fn () => $save->handle($requester, $helfer, 'Neu', null, ['qr.view', 'vehicles.view']))
        ->toThrow(fn (TeamRefused $refused) => expect($refused->reason)->toBe('role_taken'));
    expect($neu->fresh()->name)->toBe('Neu')->and($helfer->fresh()->name)->toBe('Helfer');

    app(Approvals::class)->approve($request->fresh(), m31Staff('admin'));

    expect($holders->contains(fn (Staff $staff) => $staff->fresh()->can('members.export')))->toBeFalse()
        ->and($neu->fresh()->hasPermissionTo('members.export'))->toBeTrue();
});

it('SEC-P3-14: neither the decider nor the approver of a four-eyes suspension decides the appeal against it', function () {
    $requester = m31Staff('admin');
    $approver = m31Staff('admin');
    $member = User::factory()->create();
    app(Approvals::class)->approve(app(RequestMemberSuspension::class)->handle($requester, $member, now()->toImmutable()->addDays(10), m32Statement(), m32Reason()), $approver);
    $decision = Decision::query()->where('subject_id', $member->id)->where('action', DecisionAction::Suspend->value)->sole();
    $appeal = app(FileAppeal::class)->handle($member->fresh(), $decision, DecisionViewer::Affected, 'Ich habe nichts davon geschrieben, das war nicht ich.');

    expect(fn () => app(DecideAppeal::class)->handle($approver, $appeal, AppealStatus::Upheld, 'Die Sperre bleibt bestehen.', m32Reason()))
        ->toThrow(AuthorizationException::class);
});

it('SEC-P3-15: keyword rules see through zero-width and fullwidth characters', function (string $text) {
    expect(KeywordNormaliser::matches(KeywordNormaliser::textForms($text), 'Darknet'))->toBeTrue($text);
})->with([
    'zero-width space' => ["Dark\u{200B}net"],
    'word joiner' => ["Dark\u{2060}net"],
    'fullwidth' => ['Ｄａｒｋｎｅｔ'],
]);

it('SEC-P3-15: a zero-width space does not carry a block-list term through a member write', function () {
    adm34Rule('Darknet', KeywordList::Block);
    $member = User::factory()->create();
    Sanctum::actingAs($member);
    $vehicle = Vehicle::factory()->published()->create(['owner_id' => $member->id]);

    $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['description' => "Teile gibt es im Dark\u{200B}net"])->assertStatus(422)->assertJsonPath('code', 'content_blocked');
});

it('SEC-P3-16: ai/translate reads only what the member\'s thread still shows (cleared and hidden messages are 404)', function () {
    aiOn(AiFeature::Translate);
    TranslateAgent::fake()->preventStrayPrompts();
    msgFlags();
    $a = aiMember();
    $b = aiMember();
    $old = msgStart($a, $b, 'Alte Nachricht');
    $cut = msgSend($a, $old->conversation_id, 'Bis hier gelöscht');
    $hidden = msgSend($a, $old->conversation_id, 'Ausgeblendet');
    DB::table('conversation_participants')->where('conversation_id', $old->conversation_id)->where('user_id', $b->id)->update(['cleared_before_message_id' => $cut->id]);
    DB::table('message_hidden')->insert(['message_id' => $hidden->id, 'user_id' => $b->id, 'created_at' => now()]);
    aiActAs($b);

    $this->postJson('/api/v1/ai/translate', ['source' => 'message', 'id' => $old->id, 'to' => 'en'])->assertNotFound();
    $this->postJson('/api/v1/ai/translate', ['source' => 'message', 'id' => $hidden->id, 'to' => 'en'])->assertNotFound();
    TranslateAgent::assertNeverPrompted();
});

it('SEC-P3-17: the evidence of a reported modification leaves out the owner-only notes', function () {
    seedModSchema();
    $mod = modIn(publishedVehicle(User::factory()->create()), 'exhaust', attributes: ['notes' => 'PRIVAT: Händler gab 30 % unter der Hand']);
    $case = modCaseOf(modReport(User::factory()->create(), ReportTargetType::Modification, $mod->id));

    expect(json_encode(app(CaseEvidence::class)->reveal($case, m31Staff('moderator')), JSON_UNESCAPED_UNICODE))->not->toContain('unter der Hand');
});

it('SEC-P3-25: ADM-21 masks a web notifier address until an audited reveal', function () {
    $case = adm34VehicleCase();
    Report::query()->where('case_id', $case->id)->firstOrFail()
        ->forceFill(['source' => ReportSource::WebForm, 'reporter_id' => null, 'contact_name' => 'Jana Weber', 'contact_email' => 'jana.private@example.org'])->save();
    adm34As('admin');
    expect(json_encode($this->get("/admin/moderation/cases/{$case->id}")->assertOk()->viewData('page')))->not->toContain('jana.private@example.org');
});
