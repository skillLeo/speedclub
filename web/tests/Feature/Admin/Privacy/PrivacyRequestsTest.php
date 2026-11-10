<?php

use App\Actions\Admin\Privacy\CompletePrivacyRequest;
use App\Actions\Admin\Privacy\CreatePrivacyRequest;
use App\Actions\Admin\Privacy\DownloadPrivacyEvidence;
use App\Actions\Admin\Privacy\RequestPrivacyErasure;
use App\Actions\Admin\Privacy\SendPrivacyExport;
use App\Actions\Admin\Privacy\SendPrivacyReply;
use App\Actions\Admin\Privacy\UpdatePrivacyRequest;
use App\Enums\ApprovalStatus;
use App\Enums\DataExportStatus;
use App\Enums\MemberSecurityEvent;
use App\Enums\PrivacyEvent;
use App\Enums\PrivacyReplyTemplate;
use App\Enums\PrivacyRequestStatus;
use App\Mail\PrivacyReplyMail;
use App\Models\AuditEvent;
use App\Models\PrivacyRequest;
use App\Models\User;
use App\Services\Admin\Kpi;
use App\Services\Audit\Audit;
use App\Services\Privacy\PrivacyRequests;
use App\Services\Team\TeamRefused;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Team/TeamHelpers.php';

beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    Storage::fake(config('speedclub.media.private_disk'));
});

function m36Request(array $input = []): PrivacyRequest
{
    return app(CreatePrivacyRequest::class)->handle(m31Staff('admin'), [
        'type' => 'access', 'source' => 'email', 'requester_email' => 'Jemand@Example.org', 'details' => 'Bitte um Auskunft.', ...$input,
    ]);
}

it('lets only holders of privacy.process record a request', function (string $role, bool $allowed) {
    $run = fn () => app(CreatePrivacyRequest::class)->handle(m31Staff($role), ['type' => 'access', 'source' => 'email', 'requester_email' => 'a@example.org']);

    $allowed ? expect($run()->exists)->toBeTrue() : expect($run)->toThrow(AuthorizationException::class);
})->with(m36Matrix('privacy.process'));

it('sets the deadline one month after receipt and audits without address or text', function () {
    $request = m36Request(['received_at' => '2026-10-31T10:00:00Z']);

    expect($request->due_at->toDateString())->toBe('2026-11-30')
        ->and($request->status)->toBe(PrivacyRequestStatus::Open)
        ->and($request->requester_email)->toBe('jemand@example.org');

    $event = AuditEvent::query()->where('action', PrivacyEvent::RequestCreated->value)->sole();
    expect(json_encode([$event->before, $event->after]))->not->toContain('example.org')->not->toContain('Auskunft.');
});

it('validates the request', function (array $input) {
    expect(fn () => m36Request($input))->toThrow(ValidationException::class);
})->with([
    'unknown type' => [['type' => 'wish']],
    'no address and no member' => [['requester_email' => null]],
    'received in the future' => [['received_at' => now()->addDay()->toIso8601String()]],
    'received two years ago' => [['received_at' => now()->subYears(2)->toIso8601String()]],
]);

it('extends the deadline once by two months, with a reason, only before it passed', function () {
    $request = m36Request(['received_at' => now()->subDays(10)->toIso8601String()]);
    $due = $request->due_at->copy();
    $admin = m31Staff('admin');

    expect(fn () => app(UpdatePrivacyRequest::class)->extend($admin, $request, 'kurz'))->toThrow(ValidationException::class);

    app(UpdatePrivacyRequest::class)->extend($admin, $request, 'Umfangreiche Daten aus mehreren Systemen.');
    expect($request->fresh()->due_at->toDateString())->toBe($due->copy()->addMonthsNoOverflow(2)->toDateString())
        ->and($request->fresh()->extension_reason)->toBe('Umfangreiche Daten aus mehreren Systemen.')
        ->and(fn () => app(UpdatePrivacyRequest::class)->extend($admin, $request->fresh(), m36Reason()))->toThrow(TeamRefused::class, __('team.refused.already_extended'));

    $late = m36Request(['received_at' => now()->subMonths(2)->toIso8601String()]);
    expect(fn () => app(UpdatePrivacyRequest::class)->extend($admin, $late, m36Reason()))->toThrow(TeamRefused::class, __('team.refused.past_due'));
});

it('assigns to staff who may process, and moves between open states', function () {
    $request = m36Request();
    $admin = m31Staff('admin');

    expect(fn () => app(UpdatePrivacyRequest::class)->assign($admin, $request, m31Staff('analyst')))->toThrow(ValidationException::class);

    app(UpdatePrivacyRequest::class)->assign($admin, $request, $admin);
    app(UpdatePrivacyRequest::class)->status($admin, $request->fresh(), PrivacyRequestStatus::Waiting);

    expect($request->fresh()->assigned_to)->toBe($admin->id)
        ->and($request->fresh()->status)->toBe(PrivacyRequestStatus::Waiting)
        ->and(fn () => app(UpdatePrivacyRequest::class)->status($admin, $request->fresh(), PrivacyRequestStatus::Completed))->toThrow(ValidationException::class);
});

it('completes with evidence (note or private file) and is final then', function () {
    $request = m36Request();
    $admin = m31Staff('admin');

    expect(fn () => app(CompletePrivacyRequest::class)->handle($admin, $request, PrivacyRequestStatus::Completed, null))->toThrow(TeamRefused::class, __('team.refused.evidence_required'))
        ->and(fn () => app(CompletePrivacyRequest::class)->handle($admin, $request, PrivacyRequestStatus::Rejected, null, UploadedFile::fake()->create('a.pdf', 10, 'application/pdf')))->toThrow(ValidationException::class);

    app(CompletePrivacyRequest::class)->handle($admin, $request, PrivacyRequestStatus::Completed, 'Auskunft per E-Mail versandt.', UploadedFile::fake()->create('Antwort Brief.pdf', 20, 'application/pdf'));
    $fresh = $request->fresh();

    expect($fresh->status)->toBe(PrivacyRequestStatus::Completed)
        ->and($fresh->completed_by)->toBe($admin->id)
        ->and($fresh->evidence_name)->toBe('Antwort Brief.pdf')
        ->and(Storage::disk(config('speedclub.media.private_disk'))->exists($fresh->evidence_path))->toBeTrue()
        ->and($fresh->toArray())->not->toHaveKey('evidence_path')
        ->and(fn () => app(UpdatePrivacyRequest::class)->assign($admin, $fresh, $admin))->toThrow(TeamRefused::class, __('team.refused.final'));

    $response = app(DownloadPrivacyEvidence::class)->handle(m31Staff('support'), $fresh);
    expect($response->headers->get('Cache-Control'))->toContain('no-store')
        ->and(AuditEvent::query()->where('action', PrivacyEvent::EvidenceViewed->value)->count())->toBe(1)
        ->and(fn () => app(DownloadPrivacyEvidence::class)->handle(m31Staff('analyst'), $fresh))->toThrow(AuthorizationException::class);
});

it('sends template replies DE/EN to the request address', function (string $locale, string $subject) {
    $request = m36Request(['locale' => $locale]);

    app(SendPrivacyReply::class)->handle(m31Staff('admin'), $request, PrivacyReplyTemplate::Received);

    Mail::assertSent(PrivacyReplyMail::class, fn (PrivacyReplyMail $mail) => $mail->hasTo('jemand@example.org') && $mail->locale === $locale
        && str_contains($mail->withLocale($locale, fn () => $mail->envelope()->subject), $subject));
    expect($request->fresh()->last_reply_at)->not->toBeNull()
        ->and(json_encode(AuditEvent::query()->where('action', PrivacyEvent::ReplySent->value)->sole()->after))->not->toContain('example.org');
})->with([['de', 'eingegangen'], ['en', 'We received']]);

it('sends the extension reply only after an extension, with its reason', function () {
    $request = m36Request();
    $admin = m31Staff('admin');

    expect(fn () => app(SendPrivacyReply::class)->handle($admin, $request, PrivacyReplyTemplate::Extension))->toThrow(TeamRefused::class);

    app(UpdatePrivacyRequest::class)->extend($admin, $request, 'Umfangreiche Daten aus mehreren Systemen.');
    app(SendPrivacyReply::class)->handle($admin, $request->fresh(), PrivacyReplyTemplate::Extension);

    Mail::assertSent(PrivacyReplyMail::class, fn (PrivacyReplyMail $mail) => $mail->detail === 'Umfangreiche Daten aus mehreren Systemen.');
});

it('answers an access request of a member with their own SET-12 export, never handed to staff', function () {
    Queue::fake();
    $member = User::factory()->create();
    $request = m36Request(['user_id' => $member->id, 'requester_email' => null]);

    $export = app(SendPrivacyExport::class)->handle(m31Staff('admin'), $request);

    expect($export->user_id)->toBe($member->id)
        ->and($export->requested_by_staff_id)->toBeNull()
        ->and($export->status)->toBe(DataExportStatus::Queued)
        ->and($request->fresh()->data_export_id)->toBe($export->id)
        ->and($request->fresh()->status)->toBe(PrivacyRequestStatus::InProgress)
        ->and(fn () => app(SendPrivacyExport::class)->handle(m31Staff('admin'), $request->fresh()))->toThrow(TeamRefused::class, __('team.refused.export_running'));

    $other = m36Request(['type' => 'rectification', 'user_id' => $member->id]);
    expect(fn () => app(SendPrivacyExport::class)->handle(m31Staff('admin'), $other))->toThrow(TeamRefused::class, __('team.refused.wrong_type'));
});

it('answers an erasure request through the four-eyes members.delete', function () {
    $member = User::factory()->create();
    $request = m36Request(['type' => 'erasure', 'user_id' => $member->id]);

    expect(fn () => app(RequestPrivacyErasure::class)->handle(m31Staff('support'), $request, m36Reason()))->toThrow(AuthorizationException::class);

    $approval = app(RequestPrivacyErasure::class)->handle(m31Staff('admin'), $request, m36Reason());

    expect($approval->action)->toBe('members.delete')
        ->and($request->fresh()->approval_request_id)->toBe($approval->id)
        ->and($member->fresh()->isPendingDeletion())->toBeFalse();

    expect(m36Approve($approval, m31Staff('admin'))->status)->toBe(ApprovalStatus::Executed)
        ->and($member->fresh()->isPendingDeletion())->toBeTrue();
});

it('lists members\' own SET-12 and SET-13 requests read-only as completed', function () {
    $member = User::factory()->create();
    Audit::record(MemberSecurityEvent::DataExportRequested->value, $member, actor: $member);
    Audit::record(MemberSecurityEvent::DeletionRequested->value, $member, actor: $member);

    $rows = app(PrivacyRequests::class)->selfService();

    expect(array_column($rows, 'kind'))->toEqualCanonicalizing(['export', 'erasure'])
        ->and(array_unique(array_column($rows, 'status')))->toBe(['completed'])
        ->and($rows[0]['member_id'])->toBe($member->id);
});

it('feeds the dashboard queue with requests due within 7 days, danger once one is overdue', function () {
    $admin = m31Staff('admin');
    expect(app(Kpi::class)->queues($admin)['privacy_due'])->toBe(['count' => 0, 'status' => 'ok', 'since' => null]);

    m36Request(['received_at' => now()->subDays(25)->toIso8601String()]);
    m36Request(['received_at' => now()->subDays(2)->toIso8601String()]);
    expect(app(Kpi::class)->queues($admin)['privacy_due'])->toMatchArray(['count' => 1, 'status' => 'warning']);

    $overdue = m36Request(['received_at' => now()->subDays(40)->toIso8601String()]);
    $queue = app(Kpi::class)->queues($admin)['privacy_due'];
    expect($queue['count'])->toBe(2)->and($queue['status'])->toBe('danger')
        ->and(Carbon::parse($queue['since'])->toDateString())->toBe($overdue->due_at->toDateString());

    app(CompletePrivacyRequest::class)->handle($admin, $overdue, PrivacyRequestStatus::Completed, 'Auskunft per Post versandt.');
    expect(app(Kpi::class)->queues($admin)['privacy_due']['count'])->toBe(1)
        ->and(app(Kpi::class)->queues(m31Staff('analyst')))->not->toHaveKey('privacy_due');
});
