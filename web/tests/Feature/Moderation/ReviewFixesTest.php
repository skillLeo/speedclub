<?php

use App\Actions\Moderation\LiftExpiredRestrictions;
use App\Actions\Moderation\SubmitReport;
use App\Enums\AppealStatus;
use App\Enums\DecisionAction;
use App\Enums\DecisionViewer;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Enums\UserStatus;
use App\Enums\Visibility;
use App\Mail\ReportOutcomeMail;
use App\Mail\ReportReceivedMail;
use App\Models\Appeal;
use App\Models\AuditEvent;
use App\Models\BuildUpdate;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\Notification;
use App\Models\Report;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\DataExport\ExportContents;
use App\Services\Moderation\ModerationHolds;
use App\Services\Moderation\ReportDraft;
use App\Services\Moderation\ReportTargets;
use App\Support\Moderation\ModerationText;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/ModerationTestHelpers.php';

/**
 * M2.6 code-review fix round (docs/reports/phase-2/m2.6-review.md): lifting timed suspensions, outcome-only for reporters, WEB-09 mail
 * hygiene, the explanation for illegal reports, the moderation hold, evidence within the reporter's history, the data export and the
 * listed Pest gaps.
 */
beforeEach(function () {
    $this->withoutDefer();
    $this->withHeaders(['Accept-Language' => 'de']);
    Mail::fake();
    $this->affected = User::factory()->create(['username' => 'tobi.quattro']);
    $this->reporter = User::factory()->create(['username' => 'nico.sti']);
});

describe('#1 lifting expired suspensions and restrictions', function () {
    it('lifts a suspension whose end passed, audits it, and the member shows in active-only lists again', function () {
        $this->travelTo('2026-11-01 10:00:00');
        $vehicle = modVehicle($this->affected);
        modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro')), DecisionAction::Suspend, ['until' => CarbonImmutable::parse('2026-11-05 10:00:00')]);
        $this->getJson('/api/v1/public/users/tobi.quattro')->assertNotFound();

        $this->travelTo('2026-11-05 09:59:59');
        expect(app(LiftExpiredRestrictions::class)->handle())->toBe(0)
            ->and($this->affected->refresh()->status)->toBe(UserStatus::Suspended);

        $this->travelTo('2026-11-05 10:00:00');
        $this->artisan('moderation:lift-expired-suspensions')->assertSuccessful();

        $this->affected->refresh();
        expect($this->affected->status)->toBe(UserStatus::Active)
            ->and($this->affected->restrictions)->toBeNull()
            ->and(AuditEvent::query()->where('action', 'moderation.restriction_lifted')->sole()->getAttribute('actor_type')->value)->toBe('system')
            ->and(User::query()->where('status', UserStatus::Active->value)->whereKey($this->affected->id)->exists())->toBeTrue();

        $this->getJson('/api/v1/public/users/tobi.quattro')->assertOk();
        $this->getJson("/api/v1/public/vehicles/{$vehicle->slug}")->assertOk();
        expect(app(LiftExpiredRestrictions::class)->handle())->toBe(0);
    });

    it('keeps a suspension without an end date, an unreadable date, and restrictions still in force', function () {
        $this->affected->forceFill(['status' => UserStatus::Suspended, 'restrictions' => ['suspension' => ['until' => null]]])->save();
        $odd = User::factory()->create(['status' => UserStatus::Suspended, 'restrictions' => ['suspension' => ['until' => 'tomorrow']]]);
        $future = User::factory()->restrictedFrom(RestrictionType::Messaging, now()->addDay())->create();

        expect(app(LiftExpiredRestrictions::class)->handle())->toBe(0)
            ->and($this->affected->refresh()->status)->toBe(UserStatus::Suspended)
            ->and($odd->refresh()->status)->toBe(UserStatus::Suspended)
            ->and($future->refresh()->isRestrictedFrom(RestrictionType::Messaging))->toBeTrue();
    });

    it('clears an expired restriction and keeps the others', function () {
        $this->travelTo('2026-11-01 10:00:00');
        $this->affected->forceFill(['restrictions' => [
            'messaging' => ['until' => '2026-11-02T10:00:00+00:00', 'decision_id' => 'a'],
            'publishing' => ['until' => '2026-12-02T10:00:00+00:00', 'decision_id' => 'b'],
        ]])->save();
        $this->travelTo('2026-11-03 10:00:00');

        expect(app(LiftExpiredRestrictions::class)->handle())->toBe(1)
            ->and(array_keys($this->affected->refresh()->restrictions ?? []))->toBe(['publishing']);
    });

    it('is scheduled every 15 minutes', function () {
        $this->artisan('schedule:list')->expectsOutputToContain('moderation:lift-expired-suspensions');
    });
});

describe('#2 reporters learn the outcome, never the measure', function () {
    it('collapses restrict and suspend to measures in SAFE-01, SET-16 and the notification', function (DecisionAction $action) {
        $decision = modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro')), $action, $action === DecisionAction::Suspend ? ['until' => CarbonImmutable::now()->addWeek()] : []);
        Sanctum::actingAs($this->reporter);

        $this->getJson("/api/v1/decisions/{$decision->id}")->assertOk()->assertJsonPath('data.outcome', 'measures')->assertJsonPath('data.action', null);
        $row = $this->getJson('/api/v1/me/reports')->assertOk()->json('data.0.decision');
        expect($row['outcome'])->toBe('measures')->and($row)->not->toHaveKey('action');

        $notification = $this->getJson('/api/v1/notifications')->assertOk()->json('data.0');
        expect($notification['type'])->toBe('report_decided')
            ->and($notification['details'])->toBe(['decision_id' => $decision->id, 'outcome' => 'measures'])
            ->and(json_encode($notification))->not->toContain($action->value);
    })->with([DecisionAction::Restrict, DecisionAction::Suspend]);

    it('keeps the action for the affected member', function () {
        $decision = modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro')), DecisionAction::Restrict);
        Sanctum::actingAs($this->affected);

        $this->getJson("/api/v1/decisions/{$decision->id}")->assertJsonPath('data.action', 'restrict')->assertJsonPath('data.outcome', 'measures')
            ->assertJsonPath('data.scope', ['applies_to' => 'account', 'until' => null]);
        expect(Notification::query()->where('notifiable_id', $this->affected->id)->sole()->data['action'])->toBe('restrict');
    });
});

describe('#4 WEB-09 mails', function () {
    it('names the canonical page of the target, never what was typed', function () {
        $vehicle = modVehicle($this->affected);
        $typed = config('app.url').'/app/v/'.$vehicle->slug.'?utm=<script>';

        $this->withHeaders(['Sec-Fetch-Site' => 'same-origin'])->post('/melden', [
            'url' => $typed, 'reason' => 'spam', 'details' => 'Werbung für einen fremden Shop.', 'good_faith' => '1', 'email' => 'jana@example.org',
        ])->assertStatus(303);

        Mail::assertSent(ReportReceivedMail::class, fn (ReportReceivedMail $mail) => $mail->url === url('/v/'.$vehicle->canonicalSlug()) && ! str_contains($mail->render(), 'utm'));
    });

    it('caps confirmation and outcome mails per address per day', function () {
        config(['speedclub.moderation.guest_mails_per_day' => 2]);
        $members = User::factory()->count(3)->create();

        foreach ($members as $member) {
            $this->withHeaders(['Sec-Fetch-Site' => 'same-origin'])->post('/melden', [
                'url' => config('app.url').'/u/'.$member->username, 'reason' => 'spam', 'details' => 'Werbung für einen fremden Shop.', 'good_faith' => '1', 'email' => 'Jana@Example.org',
            ])->assertStatus(303);
        }

        Mail::assertSent(ReportReceivedMail::class, 2);
        expect(Report::query()->count())->toBe(3);

        modDecide(ModerationCase::query()->oldest('id')->firstOrFail(), DecisionAction::NoAction);
        Mail::assertNotSent(ReportOutcomeMail::class);

        $this->travel(25)->hours();
        modDecide(ModerationCase::query()->where('status', 'new')->oldest('id')->firstOrFail(), DecisionAction::NoAction);
        Mail::assertSent(ReportOutcomeMail::class, 1);
    });

    it('sends one outcome mail per address and case, however often it reported', function () {
        $target = app(ReportTargets::class)->forPublicUrl(config('app.url').'/u/tobi.quattro');
        foreach (range(1, 2) as $i) {
            app(SubmitReport::class)->handle($target, new ReportDraft(source: ReportSource::WebForm, reporter: null, reason: ReportReason::Spam, details: 'Werbung für einen fremden Shop.', goodFaith: true, contactEmail: 'jana@example.org'));
        }

        modDecide(ModerationCase::query()->sole(), DecisionAction::NoAction);

        Mail::assertSent(ReportOutcomeMail::class, 1);
    });
});

describe('#5 an illegal report explains why', function () {
    it('requires details of at least 10 characters for illegal, in the app and on the web', function () {
        Sanctum::actingAs($this->reporter);
        $body = ['target_type' => 'member', 'target_id' => 'tobi.quattro', 'reason' => 'illegal', 'sub_reason' => 'privacy', 'good_faith' => true];

        $this->postJson('/api/v1/reports', $body)->assertStatus(422)->assertJsonPath('errors.details.0', 'Erklär kurz, was du gesehen hast und warum es rechtswidrig ist.');
        $this->postJson('/api/v1/reports', [...$body, 'details' => 'Adresse'])->assertStatus(422)->assertJsonPath('errors.details.0', 'Beschreib es bitte etwas genauer, mit mindestens 10 Zeichen.');
        $this->postJson('/api/v1/reports', [...$body, 'details' => 'Seine Wohnadresse steht im Profil.'])->assertCreated();

        // Other reasons keep the details optional.
        $this->postJson('/api/v1/reports', ['target_type' => 'vehicle', 'target_id' => modVehicle($this->affected)->id, 'reason' => 'spam'])->assertCreated();

        $this->withHeaders(['Sec-Fetch-Site' => 'same-origin'])->post('/melden', [
            'url' => config('app.url').'/u/tobi.quattro', 'reason' => 'spam', 'details' => 'kurz', 'good_faith' => '1',
        ])->assertStatus(422)->assertSee('mindestens 10 Zeichen');
    });
});

describe('#7 the moderation hold', function () {
    it('is lifted only by a reversed appeal of the affected member', function () {
        $vehicle = modVehicle($this->affected);
        $decision = modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Vehicle, $vehicle->id)));
        $holds = app(ModerationHolds::class);

        Appeal::factory()->create(['decision_id' => $decision->id, 'appellant_id' => $this->reporter->id, 'role' => DecisionViewer::Reporter, 'status' => AppealStatus::Reversed]);
        expect($holds->holds($vehicle))->toBeTrue();

        Appeal::factory()->create(['decision_id' => $decision->id, 'appellant_id' => $this->affected->id, 'role' => DecisionViewer::Affected, 'status' => AppealStatus::Upheld]);
        expect($holds->holds($vehicle))->toBeTrue();

        Appeal::query()->where('appellant_id', $this->affected->id)->update(['status' => AppealStatus::Reversed->value]);
        expect($holds->holds($vehicle))->toBeFalse();

        Sanctum::actingAs($this->affected);
        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'public'])->assertOk();
        expect($vehicle->refresh()->visibility)->toBe(Visibility::Public);
    });
});

describe('#9 message evidence within what the reporter sees', function () {
    it('leaves out what the reporter cleared or hid, and keeps the reported message', function () {
        $first = msgStart($this->affected, $this->reporter, 'Alt 1');
        $conversation = $first->conversation_id;
        $old = msgSend($this->affected, $conversation, 'Alt 2');
        $hidden = msgSend($this->affected, $conversation, 'Versteckt');
        $reported = msgSend($this->affected, $conversation, 'Beleidigung');
        $after = msgSend($this->reporter, $conversation, 'Danach');
        msgSide($conversation, $this->reporter)->forceFill(['cleared_before_message_id' => $old->id])->save();
        DB::table('message_hidden')->insert(['message_id' => $hidden->id, 'user_id' => $this->reporter->id]);
        Sanctum::actingAs($this->reporter);

        $this->postJson('/api/v1/reports', modBody('message', $reported->id, ['reason' => 'harassment', 'message_context' => true]))->assertCreated();

        expect(array_column(Report::query()->sole()->evidence['messages'], 'id'))->toBe([$reported->id, $after->id]);
    });
});

describe('#14 the data export', function () {
    it('holds the decisions about the member with their statements and the member\'s appeals, never who reported', function () {
        $decision = modDecidedPhoto($this->affected, $this->reporter);
        Appeal::factory()->create(['decision_id' => $decision->id, 'appellant_id' => $this->affected->id, 'text' => 'Das Foto ist von mir.']);

        $files = app(ExportContents::class)->documents($this->affected->refresh());
        $json = json_encode($files['moderation_decisions.json']);

        expect($files['moderation_decisions.json'])->toHaveCount(1)
            ->and($files['moderation_decisions.json'][0]['statement_of_reasons']['facts'])->toBe('Das Profil warb für einen fremden Shop mit Rabattcode.')
            ->and($files['appeals.json'][0]['text'])->toBe('Das Foto ist von mir.')
            ->and($json)->not->toContain($this->reporter->id)->not->toContain('nico.sti')
            ->and(app(ExportContents::class)->documents($this->reporter->refresh())['moderation_decisions.json'])->toBe([]);
    });
});

describe('#17 report matrix gaps', function () {
    it('answers 404 for content of a member across a block, either way', function (Closure $target, string $direction) {
        $id = $target($this->affected);
        $direction === 'reporter blocked' ? socBlock($this->reporter, $this->affected) : socBlock($this->affected, $this->reporter);
        Sanctum::actingAs($this->reporter);

        [$type, $value] = $id;
        $this->postJson('/api/v1/reports', modBody($type, $value))->assertNotFound()->assertJsonPath('code', 'not_found');
    })->with([
        'vehicle' => [fn (User $owner) => ['vehicle', modVehicle($owner)->id]],
        'photo' => [fn (User $owner) => ['photo', modPhoto(modVehicle($owner))->id]],
        'build update' => [fn (User $owner) => ['build_update', (string) BuildUpdate::factory()->create(['vehicle_id' => modVehicle($owner)->id])->id]],
        'modification' => [fn (User $owner) => ['modification', Modification::factory()->create(['vehicle_id' => modVehicle($owner)->id])->id]],
    ])->with(['reporter blocked', 'reporter was blocked']);

    it('takes an unlisted vehicle, reachable by its link', function () {
        Sanctum::actingAs($this->reporter);

        $this->postJson('/api/v1/reports', modBody('vehicle', Vehicle::factory()->unlisted()->create(['owner_id' => $this->affected->id])->id))->assertCreated();
    });

    it('lets a reporter appeal a no_action decision, and hides it from the affected member', function () {
        $decision = modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro')), DecisionAction::NoAction);

        Sanctum::actingAs($this->reporter);
        $this->postJson("/api/v1/decisions/{$decision->id}/appeal", ['text' => 'Das ist eindeutig Spam.'])->assertCreated();

        Sanctum::actingAs($this->affected);
        $this->postJson("/api/v1/decisions/{$decision->id}/appeal", ['text' => 'Ich auch.'])->assertNotFound();
        $this->getJson("/api/v1/decisions/{$decision->id}")->assertNotFound();
    });

    it('counts repeats by people, not submissions', function () {
        $target = app(ReportTargets::class)->forPublicUrl(config('app.url').'/u/tobi.quattro');
        $web = fn (?string $email) => app(SubmitReport::class)->handle($target, new ReportDraft(source: ReportSource::WebForm, reporter: null, reason: ReportReason::Spam, details: 'Werbung für einen fremden Shop.', goodFaith: true, contactEmail: $email));

        $web('jana@example.org');
        $web('JANA@example.org');
        $web(null);
        $web(null);
        modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro');

        $case = ModerationCase::query()->sole();
        // spam 10 + 2 for each person after the first: jana, the anonymous notices together, nico.sti.
        expect($case->report_count)->toBe(5)->and($case->priority)->toBe(10 + 2 * 2);
    });
});

describe('#3 the statement of reasons in German', function () {
    it('uses the dative after "zu" for every target', function (ReportTargetType $type, string $expected) {
        app()->setLocale('de');

        expect(ModerationText::target($type, 'Audi RS6 C8'))->toStartWith($expected)
            ->and((string) __('moderation.mail.decision.intro', ['target' => ModerationText::target($type, null)]))->not->toContain('zu dein ')->not->toContain('zu deinen');
    })->with([
        [ReportTargetType::Member, 'deinem Profil'],
        [ReportTargetType::Vehicle, 'deinem Build'],
        [ReportTargetType::Photo, 'einem Foto deines Builds'],
        [ReportTargetType::Message, 'einer Nachricht von dir'],
        [ReportTargetType::BuildUpdate, 'einem Update deines Builds'],
        [ReportTargetType::Modification, 'einer Modifikation an deinem Build'],
    ]);

    it('says what a profile removal took', function () {
        app()->setLocale('de');

        expect(ModerationText::outcome(DecisionAction::RemoveContent, null, null, ReportTargetType::Member))->toContain('Anzeigenamen')
            ->and(ModerationText::outcome(DecisionAction::RemoveContent, null, null, ReportTargetType::Photo))->toContain('den Inhalt entfernt');
    });
});
