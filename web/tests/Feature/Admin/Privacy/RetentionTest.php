<?php

use App\Actions\Admin\Privacy\UpdateRetention;
use App\Enums\ContentEvent;
use App\Enums\PrivacyRequestStatus;
use App\Enums\UserStatus;
use App\Models\AuditEvent;
use App\Models\PrivacyRequest;
use App\Models\SupportTicket;
use App\Models\User;
use App\Services\Account\HardDeleteAccount;
use App\Services\Privacy\RetentionPolicy;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Team/TeamHelpers.php';

it('lists the §4 periods with defaults and bounds, the fixed ones as such', function () {
    $rows = collect(app(RetentionPolicy::class)->catalogue())->keyBy('key');

    expect($rows['accounts_hard_delete_days'])->toMatchArray(['editable' => true, 'value' => 30, 'default' => 30, 'min' => 7, 'max' => 30])
        ->and($rows['support_tickets_months'])->toMatchArray(['value' => 24, 'min' => 6, 'max' => 24])
        ->and($rows['privacy_requests_months'])->toMatchArray(['value' => 36, 'min' => 36, 'max' => 60])
        ->and($rows['moderation_cases'])->toMatchArray(['editable' => false, 'value' => 36, 'unit' => 'months']);
});

it('lets only holders of retention.manage change the periods', function (string $role, bool $allowed) {
    $run = fn () => app(UpdateRetention::class)->handle(m31Staff($role), ['support_tickets_months' => 18], m36Reason());

    $allowed ? expect($run()->version)->toBe(1) : expect($run)->toThrow(AuthorizationException::class);
})->with(m36Matrix('retention.manage'));

it('keeps every period within its bounds and needs a reason', function (array $periods) {
    expect(fn () => app(UpdateRetention::class)->handle(m31Staff('admin'), $periods, m36Reason()))->toThrow(ValidationException::class);
})->with([
    'deletion longer than the policy promises' => [['accounts_hard_delete_days' => 31]],
    'deletion before the export window ends' => [['accounts_hard_delete_days' => 6]],
    'support tickets shorter than six months' => [['support_tickets_months' => 5]],
    'GDPR files below the limitation period' => [['privacy_requests_months' => 12]],
    'unknown key' => [['logs_days' => 3]],
    'not a number' => [['deleted_media_days' => 'viele']],
]);

it('publishes a change audited with reason and diff, and the prune steps read it', function () {
    app(UpdateRetention::class)->handle(m31Staff('admin'), ['accounts_hard_delete_days' => 14, 'support_tickets_months' => 12], 'Kürzere Fristen nach Abstimmung mit der Rechtsberatung.');

    $event = AuditEvent::query()->where('action', ContentEvent::ConfigPublished->value)->sole();
    expect($event->reason)->toBe('Kürzere Fristen nach Abstimmung mit der Rechtsberatung.')
        ->and($event->after['key'])->toBe('retention')
        ->and(app(RetentionPolicy::class)->value('accounts_hard_delete_days'))->toBe(14);

    $member = User::factory()->create(['status' => UserStatus::Deactivated, 'deletion_requested_at' => now()->subDays(13)]);
    expect(HardDeleteAccount::isDue($member))->toBeTrue();

    $old = SupportTicket::factory()->create();
    SupportTicket::query()->whereKey($old->id)->update(['updated_at' => now()->subMonths(13)]);
    $this->artisan('support:prune')->assertSuccessful();
    expect(SupportTicket::query()->whereKey($old->id)->exists())->toBeFalse();
});

it('prunes closed GDPR requests and their evidence after the period, never open ones', function () {
    Storage::fake(config('speedclub.media.private_disk'));
    $disk = Storage::disk(config('speedclub.media.private_disk'));
    $closed = PrivacyRequest::factory()->create(['status' => PrivacyRequestStatus::Completed, 'completed_at' => now()->subMonths(37), 'evidence_path' => 'privacy-evidence/x/a.pdf']);
    $disk->put('privacy-evidence/x/a.pdf', 'pdf');
    $recent = PrivacyRequest::factory()->create(['status' => PrivacyRequestStatus::Completed, 'completed_at' => now()->subMonths(35)]);
    $open = PrivacyRequest::factory()->create(['received_at' => now()->subYears(4), 'due_at' => now()->subYears(4)]);

    $this->artisan('privacy:prune')->assertSuccessful();

    expect(PrivacyRequest::query()->pluck('id')->sort()->values()->all())->toBe(collect([$recent->id, $open->id])->sort()->values()->all())
        ->and($disk->exists('privacy-evidence/x/a.pdf'))->toBeFalse()
        ->and($closed->exists)->toBeTrue();
});
