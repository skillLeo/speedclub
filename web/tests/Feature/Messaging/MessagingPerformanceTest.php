<?php

use App\Enums\ConversationFolder;
use App\Enums\MessageType;
use App\Models\Conversation;
use App\Models\ConversationParticipant;
use App\Models\Message;
use App\Models\User;
use App\Services\Messaging\MessageIds;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

require_once __DIR__.'/MessagingTestHelpers.php';

/**
 * Wall-clock probes of the inbox (200 conversations) and a 500-message thread (group perf, run alone by the phase gate, ADR-154), and a
 * query-count guard that runs with every suite: a page reads a fixed number of queries, whatever the size.
 */
function msgBulkConversation(User $member, User $other, int $messages, string $at): Conversation
{
    $conversation = Conversation::factory()->create(['pair_key' => Conversation::pairKey($member, $other), 'created_by' => $other->id]);
    $last = null;
    $rows = [];

    foreach (range(1, $messages) as $n) {
        $last = MessageIds::after($last);
        $rows[] = [
            'id' => $last, 'conversation_id' => $conversation->id, 'sender_id' => $n % 3 === 0 ? $member->id : $other->id, 'client_id' => (string) Str::uuid(),
            'type' => MessageType::Text->value, 'body' => "Nachricht $n über Fahrwerk, Felgen und den nächsten Termin auf dem Ring", 'created_at' => $at,
        ];
    }

    foreach (array_chunk($rows, 250) as $chunk) {
        Message::query()->insert($chunk);
    }

    $conversation->forceFill(['last_message_id' => $last, 'last_message_at' => $at])->save();

    foreach ([[$member, 3], [$other, 0]] as [$user, $unread]) {
        ConversationParticipant::factory()->create(['conversation_id' => $conversation->id, 'user_id' => $user->id, 'folder' => ConversationFolder::Chats, 'accepted_at' => $at, 'unread_count' => $unread])
            ->forceFill(['last_message_at' => $at])->save();
    }

    return $conversation;
}

beforeEach(function () {
    msgFlags();
});

it('reads the inbox of 200 conversations and a thread of 500 messages fast', function () {
    $lukas = ntfMember('lukas.sc');
    $others = User::factory()->count(200)->create();

    foreach ($others as $index => $other) {
        msgBulkConversation($lukas, $other, 3, now()->subMinutes($index)->format('Y-m-d H:i:s'));
    }

    $thread = msgBulkConversation($lukas, ntfMember('jann.ptrs'), 500, now()->format('Y-m-d H:i:s'));
    msgActAs($lukas);
    $times = [];

    foreach (['/api/v1/conversations?per_page=30', '/api/v1/conversations?per_page=50&q=ring', '/api/v1/notifications/unread-count', "/api/v1/conversations/{$thread->id}", "/api/v1/conversations/{$thread->id}/messages?limit=50"] as $uri) {
        $started = microtime(true);
        $this->getJson($uri)->assertOk();
        $times[$uri] = microtime(true) - $started;
    }

    $page = $this->getJson("/api/v1/conversations/{$thread->id}/messages?limit=50")->json('data');
    $started = microtime(true);
    $this->getJson("/api/v1/conversations/{$thread->id}/messages?limit=50&before=".end($page)['id'])->assertOk()->assertJsonCount(50, 'data');
    $times['before'] = microtime(true) - $started;
    $started = microtime(true);
    $this->getJson("/api/v1/conversations/{$thread->id}/messages?after={$page[0]['id']}")->assertOk()->assertJsonCount(0, 'data');
    $times['idle poll'] = microtime(true) - $started;

    fwrite(STDERR, json_encode(array_map(fn (float $seconds): string => number_format($seconds, 3).' s', $times), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES).PHP_EOL);

    expect(max($times))->toBeLessThan(1.0);
})->group('perf');

it('reads a fixed number of queries per inbox and thread page, whatever their size', function () {
    $lukas = ntfMember('lukas.sc');
    $count = function (string $uri): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        test()->getJson($uri)->assertOk();

        return count(DB::getQueryLog());
    };

    $small = msgBulkConversation($lukas, ntfMember('jann.ptrs'), 5, now()->format('Y-m-d H:i:s'));
    msgActAs($lukas);
    $inboxSmall = $count('/api/v1/conversations');
    $threadSmall = $count("/api/v1/conversations/{$small->id}/messages");

    User::factory()->count(12)->create()->each(fn (User $other, int $index) => msgBulkConversation($lukas, $other, 4, now()->subMinutes($index + 1)->format('Y-m-d H:i:s')));
    $big = msgBulkConversation($lukas, ntfMember('kenji.r34'), 60, now()->format('Y-m-d H:i:s'));

    expect($count('/api/v1/conversations'))->toBeLessThanOrEqual($inboxSmall + 2)
        ->and($count("/api/v1/conversations/{$big->id}/messages"))->toBeLessThanOrEqual($threadSmall + 2);
});
