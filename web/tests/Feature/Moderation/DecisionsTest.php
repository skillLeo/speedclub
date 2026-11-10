<?php

use App\Actions\Moderation\SubmitReport;
use App\Enums\AppealStatus;
use App\Enums\CaseStatus;
use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Enums\ModerationStatus;
use App\Enums\NotificationType;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Enums\UserStatus;
use App\Enums\Visibility;
use App\Http\Middleware\Idempotency;
use App\Mail\ModerationDecisionMail;
use App\Mail\ReportOutcomeMail;
use App\Models\Appeal;
use App\Models\AuditEvent;
use App\Models\BuildUpdate;
use App\Models\Decision;
use App\Models\Media;
use App\Models\Message;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\Report;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Auth\AuthMailer;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\ReportDraft;
use App\Services\Moderation\ReportTargets;
use App\Services\Moderation\SendDecisionMail;
use App\Services\Notifications\NotificationTexts;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/ModerationTestHelpers.php';

/**
 * M2.6 DecideCase (every action, the statement of reasons, notifications, mail, audit), GET decisions/{id} by viewer, GET me/decisions
 * and POST decisions/{id}/appeal with its deadline (m2.6-contract §2, Addendum).
 */
beforeEach(function () {
    // German first: the test client asks for English otherwise.
    $this->withHeaders(['Accept-Language' => 'de']);
    $this->withoutDefer();
    Mail::fake();
    $this->affected = User::factory()->create(['username' => 'tobi.quattro', 'locale' => 'de']);
    $this->reporter = User::factory()->create(['username' => 'nico.sti']);
});

describe('DecideCase', function () {
    it('removes a photo: rejected, its public files gone, the cover moved, the original kept', function () {
        Storage::fake('public');
        $vehicle = modVehicle($this->affected);
        $cover = modPhoto($vehicle, 1);
        $other = modPhoto($vehicle, 2);
        $vehicle->forceFill(['cover_media_id' => $cover->id])->save();
        Storage::disk('public')->put('media/'.$cover->id.'/320.webp', 'x');

        modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Photo, $cover->id)));

        $cover->refresh();
        expect($cover->moderation_status)->toBe(ModerationStatus::Rejected)
            ->and($cover->variants)->toBeNull()
            ->and($cover->original_path)->not->toBeNull()
            ->and($cover->trashed())->toBeFalse()
            ->and($vehicle->refresh()->cover_media_id)->toBe($other->id);
    });

    it('removes a profile: name, bio, avatar and cover gone', function () {
        $avatar = Media::factory()->forModel($this->affected)->create(['owner_id' => $this->affected->id]);
        $this->affected->forceFill(['avatar_media_id' => $avatar->id, 'bio' => 'Shop-Link hier', 'display_name' => 'Tobi Shop'])->save();

        modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro')));

        $this->affected->refresh();
        expect($this->affected->getAttribute('bio'))->toBeNull()
            ->and($this->affected->getAttribute('display_name'))->toBeNull()
            ->and($this->affected->getAttribute('avatar_media_id'))->toBeNull()
            ->and($avatar->refresh()->moderation_status)->toBe(ModerationStatus::Rejected);
    });

    it('removes a vehicle by making it private, and the owner cannot make it public again', function () {
        $vehicle = modVehicle($this->affected);
        modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Vehicle, $vehicle->id)));

        expect($vehicle->refresh()->visibility)->toBe(Visibility::Private);

        Sanctum::actingAs($this->affected);
        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'public'])->assertForbidden();
        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'unlisted'])->assertForbidden();
        $this->patchJson("/api/v1/vehicles/{$vehicle->id}/visibility", ['visibility' => 'private'])->assertOk();
    });

    it('hides a build update, and the owner cannot show it again', function () {
        $update = BuildUpdate::factory()->create(['vehicle_id' => modVehicle($this->affected)->id, 'note' => 'Treffen heute Nacht auf der B9']);
        modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::BuildUpdate, (string) $update->id)));

        expect($update->refresh()->hidden)->toBeTrue();

        Sanctum::actingAs($this->affected);
        $this->patchJson("/api/v1/updates/{$update->id}", ['hidden' => false])->assertForbidden();
        expect($update->refresh()->hidden)->toBeTrue();
    });

    it('soft-deletes a modification and a message', function () {
        $mod = Modification::factory()->create(['vehicle_id' => modVehicle($this->affected)->id]);
        modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Modification, $mod->id)));
        $message = msgStart($this->affected, $this->reporter, 'Beleidigung');
        modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Message, $message->id)));

        expect(Modification::withTrashed()->findOrFail($mod->id)->trashed())->toBeTrue()
            ->and(Message::withTrashed()->findOrFail($message->id)->trashed())->toBeTrue();
    });

    it('restricts messaging until a date with the decision id on the account', function () {
        $until = CarbonImmutable::now()->addDays(14);
        $decision = modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro')), DecisionAction::Restrict, ['until' => $until]);

        $this->affected->refresh();
        expect($this->affected->isRestrictedFrom(RestrictionType::Messaging))->toBeTrue()
            ->and($this->affected->isRestrictedFrom(RestrictionType::Publishing))->toBeFalse()
            ->and($this->affected->restrictions['messaging']['decision_id'])->toBe($decision->id)
            ->and($decision->restriction)->toBe(['type' => 'messaging', 'until' => $until->toIso8601String()]);

        Sanctum::actingAs($this->affected);
        $this->getJson('/api/v1/auth/me')->assertOk()
            ->assertJsonPath('data.restrictions.messaging.restricted', true)
            ->assertJsonPath('data.restrictions.messaging.decision_id', $decision->id)
            ->assertJsonPath('data.restrictions.publishing.decision_id', null);
    });

    it('suspends the account without an end date', function () {
        $decision = modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro')), DecisionAction::Suspend);

        $this->affected->refresh();
        expect($this->affected->status)->toBe(UserStatus::Suspended)
            ->and($this->affected->isSuspended())->toBeTrue()
            ->and($this->affected->restrictions['suspension'])->toBe(['until' => null, 'decision_id' => $decision->id])
            ->and($decision->restriction)->toBe(['type' => 'suspension', 'until' => null]);
    });

    it('stores the statement of reasons, closes the case for new reports and audits the decision', function () {
        $case = modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro'));
        $decision = modDecide($case, DecisionAction::RemoveContent, ['automatedDetection' => true]);

        $case->refresh();
        expect($case->status)->toBe(CaseStatus::Decided)
            ->and($case->open_target)->toBeNull()
            ->and($decision->facts())->toBe('Das Profil warb für einen fremden Shop mit Rabattcode.')
            ->and($decision->groundDocument())->toBe(GroundDocument::Community)
            ->and($decision->groundSection())->toBe('6')
            ->and($decision->automatedDetection())->toBeTrue()
            ->and($decision->automatedDecision())->toBeFalse()
            ->and(array_map(fn ($option) => $option->value, $decision->redress()))->toBe(['internal_complaint', 'out_of_court', 'court'])
            ->and($decision->notified_at)->not->toBeNull();

        $event = AuditEvent::query()->where('action', 'moderation.decided')->sole();
        expect($event->getAttribute('target_id'))->toBe($decision->id)
            ->and($event->getAttribute('reason'))->toBe('Test')
            ->and($event->getAttribute('before')['case_status'] ?? null)->toBe('new');
    });

    it('refuses a case that is not open, and a restriction without facts', function () {
        $case = modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro'));
        modDecide($case, DecisionAction::NoAction);

        expect(fn () => modDecide($case->refresh()))->toThrow(DomainException::class)
            ->and(fn () => new DecisionInput(DecisionAction::Suspend, '', '', GroundDocument::Terms))->toThrow(InvalidArgumentException::class)
            ->and(fn () => new DecisionInput(DecisionAction::Restrict, 'a', 'b', GroundDocument::Terms))->toThrow(InvalidArgumentException::class);
    });

    it('tells the affected member in the app, by an urgent push in quiet hours and by e-mail with the full statement of reasons', function () {
        config(['speedclub.push.enabled' => true]);
        Http::fake(['exp.host/*' => Http::response(['data' => [['status' => 'ok', 'id' => 'ticket-1']]])]);
        PushToken::factory()->create(['user_id' => $this->affected->id]);
        // 23:30 in Berlin, inside the default quiet hours.
        $decision = modDecidedPhoto($this->affected, $this->reporter, CarbonImmutable::parse('2026-11-10 22:30:00', 'UTC'));

        $row = Notification::query()->where('notifiable_id', $this->affected->id)->sole();
        expect($row->type)->toBe(NotificationType::ModerationDecision)
            ->and($row->data)->toEqual(['decision_id' => $decision->id, 'action' => 'remove_content'])
            ->and($row->getAttribute('pushed_at'))->not->toBeNull();

        Http::assertSent(fn ($request) => str_contains($request->url(), 'exp.host') && ($request->data()[0]['data']['path'] ?? null) === '/decision/'.$decision->id);
        Mail::assertSent(ModerationDecisionMail::class, function (ModerationDecisionMail $mail) use ($decision): bool {
            $mail->locale('de');
            $html = $mail->render();

            return $mail->hasTo($this->affected->email)
                && str_contains($html, 'Das Profil warb für einen fremden Shop mit Rabattcode.')
                && str_contains($html, 'Community-Richtlinien §6 (Kein Spam)')
                && str_contains($html, 'Wir haben eine Meldung zu einem Foto deines Builds')
                && str_contains($html, 'automatisierte Mittel haben ihn nicht erkannt')
                && str_contains($html, 'nicht automatisiert getroffen')
                && str_contains($html, 'Umfang und Dauer: Wir haben den Inhalt auf ganz SPEED CLUB entfernt')
                && str_contains($html, e(config('speedclub.legal.dispute_settlement_url')))
                && str_contains($html, '10.05.2027')
                && str_contains($html, 'Streitbeilegungsstelle')
                && str_contains($html, '/app/decision/'.$decision->id);
        });
    });

    it('tells member reporters the outcome in the app and web notifiers by e-mail, never the affected member of a no_action', function () {
        $case = modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro'));
        $web = app(SubmitReport::class)->handle(
            app(ReportTargets::class)->forPublicUrl(config('app.url').'/u/tobi.quattro'),
            new ReportDraft(source: ReportSource::WebForm, reporter: null, reason: ReportReason::Spam, details: 'Spam', goodFaith: true, contactEmail: 'hinweis@example.org', contactLocale: 'en'),
        );
        expect($web->case_id)->toBe($case->id);

        modDecide($case, DecisionAction::NoAction);

        $row = Notification::query()->where('notifiable_id', $this->reporter->id)->sole();
        expect($row->type)->toBe(NotificationType::ReportDecided)
            ->and($row->getAttribute('pushed_at'))->toBeNull()
            ->and(Notification::query()->where('notifiable_id', $this->affected->id)->exists())->toBeFalse();

        expect($row->data)->toEqual(['decision_id' => $row->data['decision_id'], 'outcome' => 'no_action']);
        Mail::assertNotSent(ModerationDecisionMail::class);
        Mail::assertSent(ReportOutcomeMail::class, function (ReportOutcomeMail $mail) use ($web): bool {
            $locale = $mail->locale;
            $html = $mail->locale('de')->render();

            // The outcome only: never the facts or the ground of the statement of reasons (Art. 16(5) DSA).
            return $mail->hasTo('hinweis@example.org') && $locale === 'en' && $mail->reference === $web->id
                && ! str_contains($html, 'Das Profil warb für einen fremden Shop') && ! str_contains($html, 'Kein Spam');
        });
    });

    it('decides through the audited operator command, which needs a reason and a named operator', function () {
        $operator = Staff::factory()->create(['email' => 'mod@speedclub.test']);
        $case = modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro'));
        $restrict = ['case' => $case->id, '--action' => 'restrict', '--restriction' => 'publishing', '--facts' => 'Spam', '--ground' => 'AGB §7'];

        $this->artisan('speedclub:moderation:decide', [...$restrict, '--operator' => 'mod@speedclub.test'])->assertExitCode(2);
        $this->artisan('speedclub:moderation:decide', [...$restrict, '--reason' => 'x'])->assertExitCode(2);
        $this->artisan('speedclub:moderation:decide', [...$restrict, '--reason' => 'x', '--operator' => 'nobody@speedclub.test'])->assertExitCode(2);
        expect($case->refresh()->status)->toBe(CaseStatus::New);

        $this->artisan('speedclub:moderation:decide', [
            'case' => $case->id, '--action' => 'restrict', '--restriction' => 'publishing', '--until' => '2099-12-01',
            '--facts' => 'Wiederholt Werbung gepostet.', '--ground' => 'AGB §7', '--document' => 'terms', '--section' => '7', '--reason' => 'Ops ticket 12',
            '--operator' => 'MOD@speedclub.test',
        ])->assertSuccessful();

        $decision = Decision::query()->sole();
        $event = AuditEvent::query()->where('action', 'moderation.decided')->sole();
        expect($this->affected->refresh()->isRestrictedFrom(RestrictionType::Publishing))->toBeTrue()
            ->and($decision->decided_by)->toBe($operator->id)
            // A date alone is the end of that day in Berlin.
            ->and($decision->restriction['until'])->toBe('2099-12-01T23:59:59+01:00')
            ->and($event->getAttribute('reason'))->toBe('Ops ticket 12')
            ->and($event->getAttribute('actor_type')->value)->toBe('staff');

        $this->artisan('speedclub:moderation:decide', ['case' => $case->id, '--action' => 'no_action', '--reason' => 'again', '--operator' => 'mod@speedclub.test'])->assertFailed();
    });

    it('suspends from the command only with the approval of a second, different staff member (four-eyes)', function () {
        $operator = Staff::factory()->create(['email' => 'mod@speedclub.test']);
        $approver = Staff::factory()->create(['email' => 'lead@speedclub.test']);
        Staff::factory()->suspended()->create(['email' => 'gone@speedclub.test']);
        $case = modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro'));
        $suspend = ['case' => $case->id, '--action' => 'suspend', '--facts' => 'Wiederholte Drohungen.', '--ground' => 'Community-Richtlinien §2', '--section' => '2', '--reason' => 'Ops 13', '--operator' => 'mod@speedclub.test'];

        $this->artisan('speedclub:moderation:decide', $suspend)->assertExitCode(2);
        $this->artisan('speedclub:moderation:decide', [...$suspend, '--approved-by' => 'mod@speedclub.test'])->assertExitCode(2);
        $this->artisan('speedclub:moderation:decide', [...$suspend, '--approved-by' => 'gone@speedclub.test'])->assertExitCode(2);
        expect($this->affected->refresh()->status)->toBe(UserStatus::Active);

        $this->artisan('speedclub:moderation:decide', [...$suspend, '--approved-by' => 'lead@speedclub.test'])->assertSuccessful();

        expect($this->affected->refresh()->status)->toBe(UserStatus::Suspended)
            ->and(AuditEvent::query()->where('action', 'moderation.decided')->sole()->getAttribute('after')['approved_by'] ?? null)->toBe($approver->id)
            ->and(fn () => new DecisionInput(DecisionAction::Suspend, 'a', 'b', GroundDocument::Terms, decidedBy: $operator))->toThrow(InvalidArgumentException::class);
    });

    it('never shortens a restriction in force: the later end wins and no end date wins over any date', function () {
        $later = CarbonImmutable::now()->addDays(30);
        $first = modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro')), DecisionAction::Restrict, ['until' => $later]);
        modDecide(modCaseOf(modReport(User::factory()->create(), ReportTargetType::Member, 'tobi.quattro')), DecisionAction::Restrict, ['until' => CarbonImmutable::now()->addDays(3)]);

        expect($this->affected->refresh()->restrictions['messaging'])->toBe(['until' => $later->toIso8601String(), 'decision_id' => $first->id]);

        $forever = modDecide(modCaseOf(modReport(User::factory()->create(), ReportTargetType::Member, 'tobi.quattro')), DecisionAction::Restrict);
        modDecide(modCaseOf(modReport(User::factory()->create(), ReportTargetType::Member, 'tobi.quattro')), DecisionAction::Restrict, ['until' => CarbonImmutable::now()->addYear()]);

        expect($this->affected->refresh()->restrictions['messaging'])->toBe(['until' => null, 'decision_id' => $forever->id]);
    });

    it('queues the statement-of-reasons mail with retries and stamps mailed_at; a final failure is logged without content', function () {
        $decision = modDecidedPhoto($this->affected, $this->reporter);

        expect($decision->refresh()->mailed_at)->not->toBeNull()
            ->and($decision->notified_at)->not->toBeNull();

        $job = new SendDecisionMail($decision->id);
        expect($job->tries)->toBeGreaterThan(1)->and($job->backoff())->toBe([60, 300, 1800]);

        Log::spy();
        $job->failed(new RuntimeException('smtp down for '.$this->affected->email));
        Log::shouldHaveReceived('error')->withArgs(fn (string $message, array $context): bool => $context === ['decision' => $decision->id, 'type' => RuntimeException::class])->once();
    });

    it('sends the mail once even when the job runs twice', function () {
        $decision = modDecidedPhoto($this->affected, $this->reporter);
        (new SendDecisionMail($decision->id))->handle(app(AuthMailer::class), app(NotificationTexts::class));

        Mail::assertSent(ModerationDecisionMail::class, 1);
    });
});

describe('GET decisions/{id}', function () {
    beforeEach(function () {
        $this->decision = modDecidedPhoto($this->affected, $this->reporter, CarbonImmutable::parse('2026-11-08 12:00:00', 'UTC'));
    });

    it('gives the affected member the full statement of reasons', function () {
        Sanctum::actingAs($this->affected);

        $data = $this->getJson("/api/v1/decisions/{$this->decision->id}")->assertOk()->json('data');

        expect($data['viewer'])->toBe('affected')
            ->and($data['action'])->toBe('remove_content')
            ->and($data['target']['type'])->toBe('photo')
            ->and($data['statement'])->toBe(['facts' => 'Das Profil warb für einen fremden Shop mit Rabattcode.', 'ground' => 'Community-Richtlinien §6 (Kein Spam)'])
            ->and($data['ground_document'])->toBe('community')
            ->and($data['ground_section'])->toBe('6')
            ->and($data['outcome'])->toBe('remove_content')
            ->and($data['scope'])->toBe(['applies_to' => 'content', 'until' => null])
            ->and($data['automated_detection'])->toBeFalse()
            ->and($data['automated_decision'])->toBeFalse()
            ->and($data['dispute_settlement_url'])->toBe(config('speedclub.legal.dispute_settlement_url'))
            ->and($data['redress'])->toBe(['internal_complaint', 'out_of_court', 'court'])
            ->and($data['appeal_until'])->toBe('2027-05-08T23:59:59+02:00')
            ->and($data['appeal'])->toBeNull()
            ->and($data['can_appeal'])->toBeTrue();
    });

    it('gives a reporter the outcome only, nothing about the other member', function () {
        Sanctum::actingAs($this->reporter);

        $data = $this->getJson("/api/v1/decisions/{$this->decision->id}")->assertOk()->json('data');

        expect($data['viewer'])->toBe('reporter')
            ->and($data['statement'])->toBeNull()
            ->and($data['ground_document'])->toBeNull()
            ->and($data['ground_section'])->toBeNull()
            ->and($data['restriction'])->toBeNull()
            ->and($data['can_appeal'])->toBeTrue();
    });

    it('hides the restriction of a suspension from the reporter', function () {
        $case = modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro'));
        $suspension = modDecide($case, DecisionAction::Suspend, ['until' => CarbonImmutable::now()->addMonth()]);

        Sanctum::actingAs($this->reporter);
        $this->getJson("/api/v1/decisions/{$suspension->id}")->assertOk()
            ->assertJsonPath('data.restriction', null)
            ->assertJsonPath('data.scope', null)
            ->assertJsonPath('data.action', null)
            ->assertJsonPath('data.outcome', 'measures');

        // The suspended member still reads why on the token they have, and can appeal (Art. 17, 20 DSA).
        Sanctum::actingAs($this->affected->refresh());
        $this->getJson("/api/v1/decisions/{$suspension->id}")->assertOk()->assertJsonPath('data.restriction.type', 'suspension');
    });

    it('is the same 404 for anybody else and an unknown id, 401 for a guest, 403 for a deactivated account', function () {
        $this->getJson("/api/v1/decisions/{$this->decision->id}")->assertUnauthorized();

        Sanctum::actingAs(User::factory()->create());
        $other = $this->getJson("/api/v1/decisions/{$this->decision->id}")->assertNotFound()->json();
        $unknown = $this->getJson('/api/v1/decisions/01JAAAAAAAAAAAAAAAAAAAAAAA')->assertNotFound()->json();
        expect($other)->toBe($unknown);
        $this->getJson('/api/v1/decisions/nope')->assertNotFound();

        Sanctum::actingAs(User::factory()->deactivated()->create());
        $this->getJson('/api/v1/decisions/01JAAAAAAAAAAAAAAAAAAAAAAA')->assertForbidden();
    });

    it('does not show a no_action decision to the affected member, who was never told', function () {
        $case = modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro'));
        $none = modDecide($case, DecisionAction::NoAction);

        Sanctum::actingAs($this->affected);
        $this->getJson("/api/v1/decisions/{$none->id}")->assertNotFound();
        Sanctum::actingAs($this->reporter);
        $this->getJson("/api/v1/decisions/{$none->id}")->assertOk()->assertJsonPath('data.outcome', 'no_action')->assertJsonPath('data.action', null);
    });

    it('stays readable for the affected member across a block and under restrictions', function () {
        socBlock($this->affected, $this->reporter);
        $this->affected->forceFill(['restrictions' => ['publishing' => ['until' => null]]])->save();

        Sanctum::actingAs($this->affected);
        $this->getJson("/api/v1/decisions/{$this->decision->id}")->assertOk();
        Sanctum::actingAs($this->reporter);
        $this->getJson("/api/v1/decisions/{$this->decision->id}")->assertOk();
    });
});

describe('GET me/decisions', function () {
    it('lists decisions that restricted the member, newest first, without no_action', function () {
        $this->travelTo('2026-10-01 10:00:00');
        $first = modDecidedPhoto($this->affected, $this->reporter);
        $this->travelTo('2026-10-05 10:00:00');
        $second = modDecide(modCaseOf(modReport($this->reporter, ReportTargetType::Member, 'tobi.quattro')), DecisionAction::Restrict, ['until' => CarbonImmutable::parse('2026-11-01 10:00:00')]);
        modDecide(modCaseOf(modReport(User::factory()->create(), ReportTargetType::Vehicle, modVehicle($this->affected)->id)), DecisionAction::NoAction);
        Appeal::factory()->create(['decision_id' => $first->id, 'appellant_id' => $this->affected->id]);
        $this->travelBack();
        Sanctum::actingAs($this->affected);

        $data = $this->getJson('/api/v1/me/decisions')->assertOk()->json('data');

        expect(array_column($data, 'id'))->toBe([$second->id, $first->id])
            ->and($data[0]['restriction'])->toBe(['type' => 'messaging', 'until' => '2026-11-01T10:00:00+00:00'])
            ->and($data[0]['target'])->toBe(['type' => 'member', 'label' => '@tobi.quattro'])
            ->and($data[0]['appeal_status'])->toBeNull()
            ->and($data[1]['appeal_status'])->toBe('open')
            ->and($data[1]['restriction'])->toBeNull();
    });

    it('lists nothing for a reporter and needs a member', function () {
        modDecidedPhoto($this->affected, $this->reporter);

        $this->getJson('/api/v1/me/decisions')->assertUnauthorized();
        Sanctum::actingAs($this->reporter);
        $this->getJson('/api/v1/me/decisions')->assertOk()->assertJsonCount(0, 'data');
    });
});

describe('POST decisions/{id}/appeal', function () {
    beforeEach(function () {
        $this->decision = modDecidedPhoto($this->affected, $this->reporter, CarbonImmutable::parse('2026-08-31 10:00:00', 'Europe/Berlin'));
    });

    it('takes the appeal of the affected member and of a reporter, one each', function () {
        $this->travelTo(CarbonImmutable::parse('2026-09-15 10:00:00'));
        Sanctum::actingAs($this->affected);
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'Das Foto habe ich selbst gemacht.'])
            ->assertCreated()->assertJsonPath('data.status', 'open')->assertJsonPath('data.decided_at', null);

        Sanctum::actingAs($this->reporter);
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'Das reicht nicht, das Konto postet das ständig.'])->assertCreated();

        expect(Appeal::query()->where('decision_id', $this->decision->id)->pluck('role')->map->value->sort()->values()->all())->toBe(['affected', 'reporter'])
            ->and(AuditEvent::query()->where('action', 'moderation.appeal_filed')->count())->toBe(2)
            ->and(json_encode(AuditEvent::query()->get()->toArray()))->not->toContain('selbst gemacht');

        Sanctum::actingAs($this->affected);
        $this->getJson("/api/v1/decisions/{$this->decision->id}")->assertJsonPath('data.appeal.status', 'open')->assertJsonPath('data.can_appeal', false);
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'Noch einmal.'])->assertStatus(409)->assertJsonPath('code', 'appeal_exists');
    });

    it('is open until the end of 28 February in Berlin for a notice of 31 August (§§ 187, 188 BGB)', function () {
        Sanctum::actingAs($this->affected);
        $this->getJson("/api/v1/decisions/{$this->decision->id}")->assertJsonPath('data.appeal_until', '2027-02-28T23:59:59+01:00');

        $this->travelTo(CarbonImmutable::parse('2027-02-28 23:59:59', 'Europe/Berlin'));
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'Gerade noch rechtzeitig.'])->assertCreated();
    });

    it('answers 422 appeal_period_over from 1 March 00:00 in Berlin', function () {
        $this->travelTo(CarbonImmutable::parse('2027-03-01 00:00:00', 'Europe/Berlin'));
        Sanctum::actingAs($this->affected);

        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'Zu spät.'])
            ->assertStatus(422)->assertJsonPath('code', 'appeal_period_over')->assertJsonPath('message', 'Die Frist für einen Einspruch ist abgelaufen.');
        $this->getJson("/api/v1/decisions/{$this->decision->id}")->assertJsonPath('data.can_appeal', false);
    });

    it('is a 404 for anybody else and validates the text', function () {
        Sanctum::actingAs(User::factory()->create());
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'Ich auch.'])->assertNotFound();

        $this->travelTo(CarbonImmutable::parse('2026-09-15 10:00:00'));
        Sanctum::actingAs($this->affected);
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => '   '])->assertStatus(422)->assertJsonValidationErrors('text');
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => str_repeat('x', 2001)])->assertStatus(422)->assertJsonValidationErrors('text');
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", [])->assertUnprocessable()->assertJsonPath('errors.text.0', 'Schreib kurz, warum die Entscheidung aus deiner Sicht falsch ist.');
    });

    it('lets a suspended member appeal on the token they still have, not a guest or a deactivated account', function () {
        $this->travelTo(CarbonImmutable::parse('2026-09-15 10:00:00'));
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'x'])->assertUnauthorized();

        $this->affected->forceFill(['status' => UserStatus::Suspended])->save();
        Sanctum::actingAs($this->affected);
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'Bitte prüft das noch einmal.'])->assertCreated();

        Sanctum::actingAs(User::factory()->deactivated()->create());
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'x'])->assertForbidden();
    });

    it('replays the first 201 for the same Idempotency-Key', function () {
        $this->travelTo(CarbonImmutable::parse('2026-09-15 10:00:00'));
        Sanctum::actingAs($this->affected);
        $headers = [Idempotency::HEADER => 'appeal-key-0001'];

        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'Einspruch.'], $headers)->assertCreated();
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'Einspruch.'], $headers)->assertCreated()->assertHeader(Idempotency::REPLAYED_HEADER);

        expect(Appeal::query()->count())->toBe(1);
    });

    it('allows 10 appeal attempts a day', function () {
        $this->travelTo(CarbonImmutable::parse('2026-09-15 10:00:00'));
        Sanctum::actingAs($this->affected);

        foreach (range(1, 10) as $i) {
            $this->postJson('/api/v1/decisions/01JAAAAAAAAAAAAAAAAAAAAAAA/appeal', ['text' => 'x'])->assertNotFound();
        }

        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'x'])->assertStatus(429);
    });

    it('keeps decisions and reports of other members unchanged when an appeal is filed', function () {
        $this->travelTo(CarbonImmutable::parse('2026-09-15 10:00:00'));
        Sanctum::actingAs($this->affected);
        $this->postJson("/api/v1/decisions/{$this->decision->id}/appeal", ['text' => 'Einspruch.'])->assertCreated();

        expect(Decision::query()->count())->toBe(1)->and(Report::query()->count())->toBe(1)
            ->and(Appeal::query()->sole()->status)->toBe(AppealStatus::Open)
            ->and(ModerationCase::query()->sole()->status)->toBe(CaseStatus::Decided)
            ->and(Vehicle::query()->count())->toBe(1);
    });
});
