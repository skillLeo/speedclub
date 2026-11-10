<?php

use App\Actions\Messaging\CloseConversationsOfPair;
use App\Enums\CaseStatus;
use App\Enums\DecisionAction;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Http\Middleware\Idempotency;
use App\Models\BuildUpdate;
use App\Models\ConversationParticipant;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Modification;
use App\Models\Report;
use App\Models\User;
use App\Models\Vehicle;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/ModerationTestHelpers.php';

/**
 * M2.6 POST reports and GET me/reports (m2.6-contract §2, Addendum): every target type, the visibility matrix, own content,
 * duplicates, good faith and sub-reason for illegal, message evidence, idempotency and the 20-a-day limit.
 */
beforeEach(function () {
    // German first: the test client asks for English otherwise.
    $this->withHeaders(['Accept-Language' => 'de']);
    $this->owner = User::factory()->create(['username' => 'paul.roadster']);
    $this->vehicle = modVehicle($this->owner);
});

describe('POST reports', function () {
    it('files a report, opens a case and answers 201 with received', function () {
        $reporter = User::factory()->create();
        Sanctum::actingAs($reporter);

        $response = $this->postJson('/api/v1/reports', modBody('vehicle', $this->vehicle->id))->assertCreated()
            ->assertJsonPath('data.status', 'received');

        $report = Report::query()->findOrFail($response->json('data.id'));
        $case = ModerationCase::query()->findOrFail($report->case_id);

        expect($report->reporter_id)->toBe($reporter->id)
            ->and($report->source)->toBe(ReportSource::App)
            ->and($report->target_type)->toBe(ReportTargetType::Vehicle)
            ->and($report->target_id)->toBe($this->vehicle->id)
            ->and($report->target_label)->not->toBe('')
            ->and($report->evidence['target']['slug'] ?? null)->toBe($this->vehicle->slug)
            ->and($case->status)->toBe(CaseStatus::New)
            ->and($case->subject_id)->toBe($this->owner->id)
            ->and($case->report_count)->toBe(1)
            ->and($case->open_target)->toBe('vehicle:'.$this->vehicle->id);
    });

    it('takes every target type by its id, a member by username in any case', function (Closure $target, ReportTargetType $type) {
        Sanctum::actingAs(User::factory()->create());
        [$id, $expected] = $target($this->owner, $this->vehicle);

        $this->postJson('/api/v1/reports', modBody($type->value, $id))->assertCreated();

        expect(Report::query()->sole()->target_id)->toBe($expected)
            ->and(ModerationCase::query()->sole()->subject_id)->toBe($this->owner->id);
    })->with([
        'member' => [fn (User $owner) => ['PAUL.Roadster', $owner->id], ReportTargetType::Member],
        'vehicle' => [fn (User $owner, $vehicle) => [strtoupper($vehicle->id), $vehicle->id], ReportTargetType::Vehicle],
        'photo' => [function (User $owner, $vehicle) {
            $photo = modPhoto($vehicle);

            return [$photo->id, $photo->id];
        }, ReportTargetType::Photo],
        'build update' => [function (User $owner, $vehicle) {
            $update = BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id]);

            return [(string) $update->id, (string) $update->id];
        }, ReportTargetType::BuildUpdate],
        'modification' => [function (User $owner, $vehicle) {
            $mod = Modification::factory()->create(['vehicle_id' => $vehicle->id]);

            return [$mod->id, $mod->id];
        }, ReportTargetType::Modification],
    ]);

    it('collects further reports in the one open case and raises its priority', function () {
        $first = modReport(User::factory()->create(), ReportTargetType::Vehicle, $this->vehicle->id);
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/v1/reports', modBody('vehicle', $this->vehicle->id, ['reason' => 'illegal', 'sub_reason' => 'street_racing', 'good_faith' => true]))->assertCreated();

        $case = ModerationCase::query()->sole();
        expect($case->id)->toBe($first->case_id)
            ->and($case->report_count)->toBe(2)
            ->and($case->priority)->toBe(45 + 2);
    });

    it('answers 409 already_reported for a second report of the same member while the case is open', function () {
        $reporter = User::factory()->create();
        Sanctum::actingAs($reporter);
        $this->postJson('/api/v1/reports', modBody('vehicle', $this->vehicle->id))->assertCreated();

        $this->postJson('/api/v1/reports', modBody('vehicle', $this->vehicle->id, ['reason' => 'other']))
            ->assertStatus(409)->assertJsonPath('code', 'already_reported');

        expect(Report::query()->count())->toBe(1);
    });

    it('opens a new case once the old one is decided', function () {
        $reporter = User::factory()->create();
        $first = modReport($reporter, ReportTargetType::Member, 'paul.roadster');
        modDecide(modCaseOf($first), DecisionAction::NoAction);
        Sanctum::actingAs($reporter);

        $this->postJson('/api/v1/reports', modBody('member', 'paul.roadster'))->assertCreated();

        expect(ModerationCase::query()->count())->toBe(2)
            ->and(Report::query()->latest('id')->firstOrFail()->case_id)->not->toBe($first->case_id);
    });

    it('answers 422 own_content for the own profile and content', function (Closure $target) {
        Sanctum::actingAs($this->owner);
        [$type, $id] = $target($this->vehicle);

        $this->postJson('/api/v1/reports', modBody($type, $id))->assertStatus(422)->assertJsonPath('code', 'own_content');

        expect(Report::query()->count())->toBe(0);
    })->with([
        'profile' => [fn () => ['member', 'paul.roadster']],
        'vehicle' => [fn ($vehicle) => ['vehicle', $vehicle->id]],
        'photo' => [fn ($vehicle) => ['photo', modPhoto($vehicle)->id]],
        'modification' => [fn ($vehicle) => ['modification', Modification::factory()->create(['vehicle_id' => $vehicle->id])->id]],
    ]);

    it('answers 404 not_found for a target the reporter cannot see, as for one that never existed', function (Closure $target) {
        Sanctum::actingAs(User::factory()->create());
        [$type, $id] = $target($this->owner);

        $this->postJson('/api/v1/reports', modBody($type, $id))->assertNotFound()->assertJsonPath('code', 'not_found');
    })->with([
        'unknown member' => [fn () => ['member', 'nobody.here']],
        'unknown vehicle' => [fn () => ['vehicle', '01JAAAAAAAAAAAAAAAAAAAAAAA']],
        'malformed id' => [fn () => ['vehicle', 'not-an-id']],
        'private vehicle' => [fn (User $owner) => ['vehicle', Vehicle::factory()->published()->private()->create(['owner_id' => $owner->id])->id]],
        'draft vehicle' => [fn (User $owner) => ['vehicle', Vehicle::factory()->create(['owner_id' => $owner->id])->id]],
        'unverified member' => [fn () => ['member', User::factory()->unverified()->create()->username]],
        'suspended member' => [fn () => ['member', User::factory()->suspended()->create()->username]],
        'rejected photo' => [fn (User $owner) => ['photo', Media::factory()->forModel(modVehicle($owner))->create(['owner_id' => $owner->id, 'moderation_status' => 'rejected'])->id]],
        'hidden build update' => [fn (User $owner) => ['build_update', (string) BuildUpdate::factory()->create(['vehicle_id' => modVehicle($owner)->id, 'hidden' => true])->id]],
        'message of a conversation the reporter is not in' => [function (User $owner) {
            $message = msgStart($owner, User::factory()->create());

            return ['message', $message->id];
        }],
    ]);

    it('runs the authorisation and visibility matrix on a member target', function (Closure $viewer, int $status, ?string $code) {
        socActAs($viewer($this->owner));

        $response = $this->postJson('/api/v1/reports', modBody('member', 'paul.roadster'))->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [201, null],
        // A safety tool: open before verification, under restrictions and a suspension.
        'unverified member' => [201, null],
        'member restricted from publishing' => [201, null],
        'member restricted from messaging' => [201, null],
        'suspended member' => [201, null],
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [404, 'not_found'],
        'member the other blocked' => [404, 'not_found'],
    ]));

    it('answers 403 to a deactivated account before any lookup', function () {
        Sanctum::actingAs(User::factory()->deactivated()->create());

        $this->postJson('/api/v1/reports', modBody('member', 'nobody.here'))->assertForbidden();
    });

    it('validates the body', function (array $overrides, string $field) {
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/v1/reports', modBody('member', 'paul.roadster', $overrides))
            ->assertStatus(422)->assertJsonPath('code', 'validation_failed')->assertJsonValidationErrors($field);
    })->with([
        'no target type' => [['target_type' => null], 'target_type'],
        'unknown target type' => [['target_type' => 'comment'], 'target_type'],
        'no target id' => [['target_id' => ''], 'target_id'],
        'long target id' => [['target_id' => str_repeat('a', 65)], 'target_id'],
        'no reason' => [['reason' => null], 'reason'],
        'unknown reason' => [['reason' => 'rude'], 'reason'],
        'details over 1000' => [['details' => str_repeat('x', 1001)], 'details'],
        'illegal without sub-reason' => [['reason' => 'illegal', 'good_faith' => true], 'sub_reason'],
        'illegal with an unknown sub-reason' => [['reason' => 'illegal', 'sub_reason' => 'speeding', 'good_faith' => true], 'sub_reason'],
        'illegal without good faith' => [['reason' => 'illegal', 'sub_reason' => 'privacy'], 'good_faith'],
        'illegal with good faith false' => [['reason' => 'illegal', 'sub_reason' => 'privacy', 'good_faith' => false], 'good_faith'],
        'illegal with good faith as a string' => [['reason' => 'illegal', 'sub_reason' => 'privacy', 'good_faith' => 'yes'], 'good_faith'],
        'sub-reason without illegal' => [['sub_reason' => 'privacy'], 'sub_reason'],
        'message context on a member' => [['message_context' => true], 'message_context'],
    ]);

    it('says in German what is missing for an illegal report', function () {
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/v1/reports', modBody('member', 'paul.roadster', ['reason' => 'illegal']))
            ->assertStatus(422)
            ->assertJsonPath('errors.sub_reason.0', 'Wähl aus, welcher Rechtsverstoß es ist.')
            ->assertJsonPath('errors.good_faith.0', 'Bestätige, dass deine Angaben nach bestem Wissen richtig und vollständig sind.');
    });

    it('stores good faith and the sub-reason of an illegal report', function () {
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/v1/reports', modBody('member', 'paul.roadster', ['reason' => 'illegal', 'sub_reason' => 'hate_speech', 'good_faith' => true]))->assertCreated();

        $report = Report::query()->sole();
        expect($report->good_faith)->toBeTrue()
            ->and($report->sub_reason?->value)->toBe('hate_speech')
            ->and(ModerationCase::query()->sole()->priority)->toBe(50);
    });

    it('replays the first 201 for the same Idempotency-Key and files one report', function () {
        Sanctum::actingAs(User::factory()->create());
        $headers = [Idempotency::HEADER => 'report-key-0001'];

        $first = $this->postJson('/api/v1/reports', modBody('member', 'paul.roadster'), $headers)->assertCreated();
        $second = $this->postJson('/api/v1/reports', modBody('member', 'paul.roadster'), $headers)->assertCreated();

        expect($second->json('data.id'))->toBe($first->json('data.id'))
            ->and($second->headers->get(Idempotency::REPLAYED_HEADER))->not->toBeNull()
            ->and(Report::query()->count())->toBe(1);
    });

    it('allows 20 reports a day per member, then 429', function () {
        Sanctum::actingAs(User::factory()->create());
        $targets = User::factory()->count(21)->create();

        foreach ($targets->take(20) as $target) {
            $this->postJson('/api/v1/reports', modBody('member', $target->username))->assertCreated();
        }

        $this->postJson('/api/v1/reports', modBody('member', $targets->last()->username))
            ->assertStatus(429)->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After');
    });

    it('keeps report details out of the log', function () {
        Sanctum::actingAs(User::factory()->create());
        $this->postJson('/api/v1/reports', modBody('member', 'paul.roadster', ['details' => 'GEHEIMER-HINWEIS-123']))->assertCreated();

        expect(json_encode(Report::query()->sole()->toArray()))->not->toContain('GEHEIMER-HINWEIS-123');
    });
});

describe('POST reports for a message', function () {
    beforeEach(function () {
        $this->reporter = User::factory()->create(['username' => 'nina.neu']);
        $first = msgStart($this->owner, $this->reporter, 'Hallo');
        $conversation = $first->conversation_id;
        $this->thread = [$first];

        foreach (range(1, 7) as $i) {
            $this->thread[] = msgSend($i % 2 === 0 ? $this->owner : $this->reporter, $conversation, "Nachricht $i");
        }

        $this->reported = $this->thread[4];
        foreach (range(8, 14) as $i) {
            $this->thread[] = msgSend($i % 2 === 0 ? $this->owner : $this->reporter, $conversation, "Nachricht $i");
        }
    });

    it('keeps the reported message and up to 5 before and after it, nothing else of the thread', function () {
        Sanctum::actingAs($this->reporter);

        $this->postJson('/api/v1/reports', modBody('message', $this->reported->id, ['reason' => 'harassment', 'message_context' => true]))->assertCreated();

        $messages = Report::query()->sole()->evidence['messages'];
        $ids = array_column($messages, 'id');
        $expected = array_map(fn ($message) => $message->id, array_slice($this->thread, 0, 10));

        expect($ids)->toBe($expected)
            ->and(collect($messages)->firstWhere('reported', true)['id'])->toBe($this->reported->id)
            ->and(collect($messages)->firstWhere('reported', true)['from'])->toBe('reported')
            ->and(collect($messages)->pluck('from')->unique()->sort()->values()->all())->toBe(['reported', 'reporter'])
            ->and(collect($messages)->firstWhere('reported', true)['body'])->toBe('Nachricht 4');
    });

    it('keeps only the reported message without message_context', function () {
        Sanctum::actingAs($this->reporter);

        $this->postJson('/api/v1/reports', modBody('message', $this->reported->id, ['reason' => 'harassment']))->assertCreated();

        expect(array_column(Report::query()->sole()->evidence['messages'], 'id'))->toBe([$this->reported->id]);
    });

    it('stores the evidence encrypted, never as readable text in the table', function () {
        Sanctum::actingAs($this->reporter);
        $this->postJson('/api/v1/reports', modBody('message', $this->reported->id, ['reason' => 'harassment', 'message_context' => true]))->assertCreated();

        expect((string) DB::table('reports')->value('evidence'))->not->toContain('Nachricht 4');
    });

    it('lets the participant report after blocking the sender, so block and report work in either order', function () {
        socBlock($this->reporter, $this->owner);
        app(CloseConversationsOfPair::class)->handle($this->reporter, $this->owner);
        Sanctum::actingAs($this->reporter);

        $this->postJson('/api/v1/reports', modBody('message', $this->reported->id, ['reason' => 'harassment']))->assertCreated();
    });

    it('refuses a message of the reporter themselves and a withdrawn message', function () {
        $own = collect($this->thread)->first(fn ($message) => $message->sender_id === $this->reporter->id);
        Sanctum::actingAs($this->reporter);

        $this->postJson('/api/v1/reports', modBody('message', $own->id))->assertStatus(422)->assertJsonPath('code', 'own_content');

        $this->reported->delete();
        $this->postJson('/api/v1/reports', modBody('message', $this->reported->id))->assertNotFound();
    });

    it('is a 404 for a member outside the conversation', function () {
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/v1/reports', modBody('message', $this->reported->id))->assertNotFound();
        expect(ConversationParticipant::query()->count())->toBe(2);
    });
});

describe('GET me/reports', function () {
    it('lists the own reports newest first with status and decision', function () {
        $reporter = User::factory()->create();
        $this->travelTo('2026-10-01 10:00:00');
        $old = modReport($reporter, ReportTargetType::Member, 'paul.roadster');
        $this->travelTo('2026-10-02 10:00:00');
        modDecide(modCaseOf($old));
        $new = modReport($reporter, ReportTargetType::Vehicle, $this->vehicle->id);
        $this->travelBack();
        modReport(User::factory()->create(), ReportTargetType::Vehicle, modVehicle()->id);
        Sanctum::actingAs($reporter);

        $response = $this->getJson('/api/v1/me/reports')->assertOk();

        expect($response->json('data.*.id'))->toBe([$new->id, $old->id])
            ->and($response->json('data.0.status'))->toBe('received')
            ->and($response->json('data.0.decision'))->toBeNull()
            ->and($response->json('data.0.target'))->toBe(['type' => 'vehicle', 'label' => $new->target_label])
            ->and($response->json('data.1.status'))->toBe('decided')
            ->and($response->json('data.1.decision.outcome'))->toBe('remove_content')
            ->and($response->json('data.1.decision'))->not->toHaveKey('action')
            ->and($response->json('data.1.decision.appeal_status'))->toBeNull()
            ->and($response->json('data.1.target'))->toBe(['type' => 'member', 'label' => '@paul.roadster'])
            ->and($response->json('data.1.reason'))->toBe('spam')
            ->and($response->json('data.1.sub_reason'))->toBeNull();
    });

    it('pages with a cursor and refuses a forged one', function () {
        $reporter = User::factory()->create();
        foreach (User::factory()->count(3)->create() as $member) {
            modReport($reporter, ReportTargetType::Member, $member->username);
        }
        Sanctum::actingAs($reporter);

        $page = $this->getJson('/api/v1/me/reports?per_page=2')->assertOk();
        $next = $this->getJson('/api/v1/me/reports?per_page=2&cursor='.$page->json('meta.next_cursor'))->assertOk();

        expect(count($page->json('data')) + count($next->json('data')))->toBe(3);
        $this->getJson('/api/v1/me/reports?cursor=forged')->assertStatus(422);
        $this->getJson('/api/v1/me/reports?per_page=51')->assertStatus(422);
    });

    it('needs a member and is open under restrictions, not to a deactivated account', function () {
        $this->getJson('/api/v1/me/reports')->assertUnauthorized();

        Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create());
        $this->getJson('/api/v1/me/reports')->assertOk();

        Sanctum::actingAs(User::factory()->deactivated()->create());
        $this->getJson('/api/v1/me/reports')->assertForbidden();
    });
});
