<?php

use App\Actions\Admin\Members\RestrictMember;
use App\Actions\Admin\Members\StartViewAs;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Models\AuditEvent;
use App\Models\Block;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\KnownDevice;
use App\Models\Message;
use App\Models\User;
use App\Services\Admin\Members\MemberRecord;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Mail;

require_once __DIR__.'/Helpers.php';

/**
 * M3.2 §2 (ADM-10 tabs): MemberRecord gives the admin plain arrays: the address masked without members.view_pii and revealed only by
 * an audited click, devices without fingerprints or IPs, message metadata as counts without any content (audited, own atom), reports
 * both ways, consents and exports.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    $this->member = User::factory()->create(['username' => 'lena.gti', 'email' => 'lena@gmail.de'])->refresh();
    $this->record = app(MemberRecord::class);
});

it('masks the address in the overview for every role and reveals it only through the audited click (SF-2, SEC-P3-02)', function (string $role) {
    $overview = $this->record->overview($this->member, $viewer = m31Staff($role));

    expect($overview['email'])->toBe('l***@g***.de')
        ->and($overview['email_masked'])->toBeTrue()
        ->and($overview['can_reveal_pii'])->toBe($viewer->can('members.view_pii'))
        ->and(json_encode($overview))->not->toContain('lena@gmail.de')
        ->and(AuditEvent::query()->where('action', 'member.pii_viewed')->count())->toBe(0);
})->with(M31_ROLES);

it('returns the address from revealPii alone, audited with the reason, and refuses staff without members.view_pii', function () {
    expect(fn () => $this->record->revealPii($this->member, m31Staff('analyst')))->toThrow(AuthorizationException::class)
        ->and(fn () => $this->record->revealPii($this->member, m31Staff('moderator')))->toThrow(AuthorizationException::class)
        ->and(AuditEvent::query()->where('action', 'member.pii_viewed')->count())->toBe(0);

    $support = m31Staff('support');

    expect($this->record->revealPii($this->member, $support, 'Ticket 4711: Rückruf')['email'])->toBe('lena@gmail.de');

    $event = AuditEvent::query()->where('action', 'member.pii_viewed')->sole();
    expect($event->actor_id)->toBe((string) $support->id)
        ->and($event->reason)->toBe('Ticket 4711: Rückruf')
        ->and($event->target_id)->toBe($this->member->id);
});

it('lists restrictions with their decision and end', function () {
    $decision = app(RestrictMember::class)->handle(m31Staff('moderator'), $this->member, RestrictionType::Messaging, now()->addDays(7)->toImmutable(), m32Statement(), m32Reason());

    $overview = $this->record->overview($this->member->refresh(), m31Staff('admin'));

    expect($overview['restrictions'])->toHaveCount(1)
        ->and($overview['restrictions'][0]['type'])->toBe('messaging')
        ->and($overview['restrictions'][0]['decision_id'])->toBe($decision->id)
        ->and($overview['counters']['decisions'])->toBe(1);
});

it('lists devices and sign-ins without fingerprints, and flags view-as tokens', function () {
    $this->member->createToken('Pixel 8', ['member']);
    KnownDevice::factory()->create(['user_id' => $this->member->id]);
    app(StartViewAs::class)->handle(m31Staff('admin'), $this->member, m32Reason(), false);

    $security = $this->record->security($this->member);

    expect($security['devices'])->toHaveCount(2)
        ->and(collect($security['devices'])->where('view_as', true)->count())->toBe(1)
        ->and($security['sign_ins'])->toHaveCount(1)
        ->and(json_encode($security))->not->toContain('fingerprint')->not->toContain('"ip"');
});

it('counts message metadata without any content, only with members.message_metadata, audited', function () {
    $other = User::factory()->create();
    $conversation = Conversation::factory()->create(['created_by' => $this->member->id]);
    ConversationParticipant::factory()->create(['conversation_id' => $conversation->id, 'user_id' => $this->member->id, 'accepted_at' => now()]);
    ConversationParticipant::factory()->create(['conversation_id' => $conversation->id, 'user_id' => $other->id, 'accepted_at' => now()]);
    Message::factory()->create(['conversation_id' => $conversation->id, 'sender_id' => $this->member->id, 'body' => 'Streng geheimer Inhalt']);
    Block::factory()->create(['blocker_id' => $other->id, 'blocked_id' => $this->member->id]);

    expect(fn () => $this->record->messageMetadata($this->member, m31Staff('moderator')))->toThrow(AuthorizationException::class);

    $metadata = $this->record->messageMetadata($this->member, m31Staff('admin'));

    expect($metadata['conversations'])->toBe(1)
        ->and($metadata['requests_sent_30_days'])->toBe(1)
        ->and($metadata['accepted_rate_30_days'])->toBe(1.0)
        ->and($metadata['blocks_received'])->toBe(1)
        ->and($metadata)->not->toHaveKey('body')
        ->and(json_encode($metadata))->not->toContain('geheimer')
        ->and(AuditEvent::query()->where('action', 'member.message_metadata_viewed')->count())->toBe(1);
});

it('lists reports as reporter and as target, and the privacy state', function () {
    $reporter = User::factory()->create();
    modReport($reporter, ReportTargetType::Member, 'lena.gti');
    modReport($this->member, ReportTargetType::Member, (string) $reporter->username);

    $reports = $this->record->reports($this->member);
    $privacy = $this->record->privacy($this->member);

    expect($reports['as_reporter'])->toHaveCount(1)
        ->and($reports['as_target'])->toHaveCount(1)
        ->and($reports['as_target'][0]['origin'])->toBe('report')
        ->and($privacy['deletion']['requested_at'])->toBeNull()
        ->and($privacy)->toHaveKeys(['consents', 'exports']);
});
