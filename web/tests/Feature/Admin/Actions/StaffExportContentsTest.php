<?php

use App\Actions\Admin\Members\RequestMemberExport;
use App\Enums\ApprovalStatus;
use App\Enums\DataExportStatus;
use App\Models\DataExport;
use App\Models\Media;
use App\Models\User;
use App\Services\DataExport\BuildDataExport;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/Helpers.php';
require_once __DIR__.'/../../Messaging/MessagingTestHelpers.php';
require_once __DIR__.'/../../Settings/SettingsTestHelpers.php';

/**
 * SEC-P3-01: the four-eyes staff export of a member (members.export) carries no message text, chat photo or reaction of anybody:
 * per conversation only the partner, folder, dates and counts. The member's own SET-12 copy keeps them (control).
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    Storage::fake('local');
    Storage::fake(config()->string('speedclub.media.private_disk'));
    msgFlags();
    $this->member = User::factory()->create(['username' => 'mia.rs3', 'locale' => 'de']);
    $this->other = User::factory()->create(['username' => 'jonas.m3']);
    $first = msgStart($this->other, $this->member, 'Meine Handynummer ist 0151 1234567');
    msgSend($this->member, $first->conversation_id, 'Danke, ich ruf dich an.');
    $this->conversationId = $first->conversation_id;
});

it('builds the staff copy without any message body, chat photo or reaction', function () {
    $chatPhoto = Media::factory()->create(['owner_id' => $this->member->id, 'mediable_type' => 'conversation', 'mediable_id' => $this->conversationId, 'original_path' => 'originals/chat-1.jpg']);
    Storage::disk(config()->string('speedclub.media.private_disk'))->put('originals/chat-1.jpg', 'chat-photo-bytes');

    $done = m32Approve(app(RequestMemberExport::class)->handle(m31Staff('admin'), $this->member, m32Reason()));
    $export = DataExport::query()->sole();

    expect($done->status)->toBe(ApprovalStatus::Executed)->and($export->refresh()->status)->toBe(DataExportStatus::Ready);

    $entries = setReadZip($export);
    $all = implode("\n", $entries);
    $conversations = json_decode((string) $entries['conversations/0001.json'], true);

    expect($all)->not->toContain('0151 1234567')
        ->not->toContain('ich ruf dich an')
        ->not->toContain('chat-photo-bytes')
        ->and(array_keys($entries))->not->toContain('photos/'.$chatPhoto->id.'.jpg')
        ->and($conversations[0])->not->toHaveKey('body')
        ->and($conversations[0]['with'])->toBe(['jonas.m3'])
        ->and($conversations[0]['messages'])->toBe(2)
        ->and($conversations[0]['messages_sent'])->toBe(1)
        ->and(json_decode((string) $entries['reactions.json'], true))->toBe(['count' => 0])
        ->and((string) $entries['README.txt'])->toContain('ohne Nachrichtentexte');
});

it('keeps the messages in the member\'s own SET-12 copy (control)', function () {
    $export = new DataExport;
    $export->forceFill(['user_id' => $this->member->id, 'status' => DataExportStatus::Queued, 'requested_at' => now()])->save();
    BuildDataExport::dispatchSync($export->id);

    expect(implode("\n", setReadZip($export->refresh())))->toContain('0151 1234567');
});
