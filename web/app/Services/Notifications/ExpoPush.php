<?php

namespace App\Services\Notifications;

use App\Models\PushToken;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * The Expo Push API (05_ARCHITECTURE §11, ADR-010): batches of 100 to push/send, tickets kept for push:receipts, which drops tokens Expo
 * reports as DeviceNotRegistered. With speedclub.push.enabled off nothing leaves the server, and nothing else changes.
 *
 * Logs never carry a token, a title or a body: only counts and exception classes (05_ARCHITECTURE §15).
 */
class ExpoPush
{
    private const NOT_REGISTERED = 'DeviceNotRegistered';

    public function enabled(): bool
    {
        return config()->boolean('speedclub.push.enabled');
    }

    /**
     * One message to every token of the list. No retry: a batch that half arrived would arrive twice.
     *
     * @param  iterable<PushToken>  $tokens
     * @param  array<string, scalar|null>  $data
     * @return int tickets received
     */
    public function send(iterable $tokens, string $title, string $body, array $data): int
    {
        if (! $this->enabled()) {
            return 0;
        }

        $byToken = [];

        foreach ($tokens as $token) {
            $byToken[] = $token;
        }

        $tickets = 0;

        foreach (array_chunk($byToken, max(1, config()->integer('speedclub.push.batch_size'))) as $batch) {
            $messages = array_map(fn (PushToken $token): array => [
                'to' => $token->getAttribute('token'),
                'title' => $title,
                'body' => $body,
                'data' => $data,
                'sound' => 'default',
            ], $batch);

            try {
                $response = $this->client()->post(config()->string('speedclub.push.send_url'), $messages)->throw();
            } catch (ConnectionException|RequestException $exception) {
                Log::warning('Expo push send failed.', ['type' => $exception::class, 'messages' => count($messages)]);

                continue;
            }

            /** @var mixed $results */
            $results = $response->json('data');
            $tickets += $this->keepTickets($batch, is_array($results) ? array_values($results) : []);
        }

        return $tickets;
    }

    /**
     * Asks Expo for the receipts of tickets older than a quarter of an hour, drops tokens of uninstalled apps and forgets the tickets.
     * Tickets older than ticket_max_age_hours go unasked: Expo no longer has their receipts.
     *
     * @return array{checked: int, removed_tokens: int}
     */
    public function checkReceipts(): array
    {
        DB::table('push_tickets')->where('created_at', '<', Carbon::now()->subHours(config()->integer('speedclub.push.ticket_max_age_hours')))->delete();

        if (! $this->enabled()) {
            return ['checked' => 0, 'removed_tokens' => 0];
        }

        $checked = 0;
        $removed = 0;
        $tickets = DB::table('push_tickets')
            ->where('created_at', '<=', Carbon::now()->subMinutes(15))
            ->orderBy('id')
            ->limit(config()->integer('speedclub.push.receipts_batch_size') * 5)
            ->get(['id', 'ticket_id', 'push_token_id']);

        foreach ($tickets->chunk(max(1, config()->integer('speedclub.push.receipts_batch_size'))) as $chunk) {
            try {
                $response = $this->client()->post(config()->string('speedclub.push.receipts_url'), [
                    'ids' => $chunk->pluck('ticket_id')->values()->all(),
                ])->throw();
            } catch (ConnectionException|RequestException $exception) {
                Log::warning('Expo push receipts failed.', ['type' => $exception::class, 'tickets' => $chunk->count()]);

                continue;
            }

            /** @var mixed $receipts */
            $receipts = $response->json('data');
            $receipts = is_array($receipts) ? $receipts : [];
            $dead = [];

            foreach ($chunk as $ticket) {
                /** @var object{id: int, ticket_id: string, push_token_id: string} $ticket */
                $receipt = $receipts[$ticket->ticket_id] ?? null;

                if (is_array($receipt) && ($receipt['details']['error'] ?? null) === self::NOT_REGISTERED) {
                    $dead[] = $ticket->push_token_id;
                }
            }

            $removed += $dead === [] ? 0 : PushToken::query()->whereKey(array_values(array_unique($dead)))->delete();
            DB::table('push_tickets')->whereIn('id', $chunk->pluck('id')->all())->delete();
            $checked += $chunk->count();
        }

        return ['checked' => $checked, 'removed_tokens' => $removed];
    }

    /**
     * @param  list<PushToken>  $batch
     * @param  list<mixed>  $results  in the order of the messages
     */
    private function keepTickets(array $batch, array $results): int
    {
        $rows = [];
        $dead = [];

        foreach ($batch as $index => $token) {
            $result = $results[$index] ?? null;

            if (! is_array($result)) {
                continue;
            }

            if (($result['status'] ?? null) === 'ok' && is_string($result['id'] ?? null)) {
                $rows[] = ['ticket_id' => mb_substr($result['id'], 0, 64), 'push_token_id' => $token->getKey(), 'created_at' => Carbon::now()];
            } elseif (($result['details']['error'] ?? null) === self::NOT_REGISTERED) {
                $dead[] = $token->getKey();
            }
        }

        if ($rows !== []) {
            DB::table('push_tickets')->insertOrIgnore($rows);
        }

        if ($dead !== []) {
            PushToken::query()->whereKey($dead)->delete();
        }

        return count($rows);
    }

    private function client(): PendingRequest
    {
        $client = Http::acceptJson()
            ->asJson()
            ->timeout(config()->integer('speedclub.push.timeout_seconds'))
            ->withHeaders(['Accept-Encoding' => 'gzip, deflate']);

        $token = config('speedclub.services.expo_access_token');

        return is_string($token) && $token !== '' ? $client->withToken($token) : $client;
    }
}
