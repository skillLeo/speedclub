<?php

use App\Enums\MessageType;
use App\Models\Message;
use App\Support\Queue\ScrubbedException;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

require_once __DIR__.'/MessagingTestHelpers.php';

/**
 * A job that copies a message and fails on the unique (sender_id, client_id): MySQL's message quotes the duplicate values.
 */
final class MsgDuplicateMessageJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public function __construct(public readonly string $messageId) {}

    public function handle(): void
    {
        $original = Message::query()->findOrFail($this->messageId);

        Message::query()->insert([
            'id' => strtolower((string) Str::ulid()),
            'conversation_id' => $original->conversation_id,
            'sender_id' => $original->sender_id,
            'client_id' => $original->client_id,
            'type' => MessageType::Text->value,
            'body' => $original->body,
            'created_at' => now(),
        ]);
    }
}

it('keeps no message text in failed_jobs.exception (BL-2)', function () {
    $lukas = ntfMember('lukas.sc');
    $message = msgStart(ntfMember('jann.ptrs'), $lukas, 'Mein Code für die Halle ist 4711-GEHEIM');
    // The client id holds a value as well: it is what MySQL quotes in "Duplicate entry".
    Message::query()->whereKey($message->id)->update(['client_id' => '4711-GEHEIM-client']);

    dispatch(new MsgDuplicateMessageJob($message->id))->onConnection('database');
    $this->artisan('queue:work', ['connection' => 'database', '--once' => true, '--tries' => 1, '--stop-when-empty' => true]);

    $failed = DB::table('failed_jobs')->first();

    expect($failed)->not->toBeNull()
        ->and($failed->exception)->toContain('Illuminate\Database\UniqueConstraintViolationException (code 23000)')
        ->and($failed->exception)->toContain('SQL: insert into `messages`')
        ->and($failed->exception)->toContain('values (?, ?, ?, ?, ?, ?, ?)')
        ->and($failed->exception)->toContain('Caused by: PDOException')
        ->and($failed->exception)->not->toContain('4711')
        ->and($failed->exception)->not->toContain('GEHEIM')
        ->and($failed->exception)->not->toContain('Duplicate entry')
        ->and($failed->payload)->not->toContain('GEHEIM');
});

it('describes any exception without its message', function () {
    $summary = ScrubbedException::describe(new RuntimeException('Hallo Lukas, mein Passwort ist hunter2', 42, new LogicException('noch ein Geheimnis')));

    expect($summary)->toStartWith('RuntimeException (code 42)')
        ->and($summary)->toContain('Caused by: LogicException (code 0)')
        ->and($summary)->not->toContain('hunter2')
        ->and($summary)->not->toContain('Geheimnis')
        ->and((string) new ScrubbedException(new RuntimeException('x')))->toStartWith('RuntimeException');
});
