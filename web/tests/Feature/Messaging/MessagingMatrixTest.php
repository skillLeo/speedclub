<?php

use App\Enums\RestrictionType;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once __DIR__.'/MessagingTestHelpers.php';

/**
 * The authorisation matrix of every conversation and message route (m2.4-contract §2): a participant gets the answer, anyone who is not
 * an active participant gets 404 (never 403), a guest 401; an unverified participant may read but not write (403 email_not_verified),
 * one restricted from messaging may read and tidy up but not reach the other side (403 account_restricted).
 */
const MSG_ROUTES = [
    'show' => ['GET', 'conversations/{c}', 200, 'read'],
    'messages' => ['GET', 'conversations/{c}/messages', 200, 'read'],
    'send' => ['POST', 'conversations/{c}/messages', 201, 'reach'],
    'upload' => ['POST', 'conversations/{c}/media', 201, 'reach'],
    'typing' => ['POST', 'conversations/{c}/typing', 204, 'reach'],
    'react' => ['POST', 'messages/{m}/reactions', 200, 'reach'],
    'read' => ['POST', 'conversations/{c}/read', 204, 'own'],
    'organise' => ['PATCH', 'conversations/{c}', 200, 'own'],
    'delete conversation' => ['DELETE', 'conversations/{c}', 204, 'own'],
    'hide message' => ['DELETE', 'messages/{m}', 204, 'own'],
    'unreact' => ['DELETE', 'messages/{m}/reactions', 200, 'own'],
];

const MSG_VIEWERS = ['participant', 'other member', 'participant who blocked the other', 'participant the other blocked', 'participant restricted from messaging', 'unverified participant', 'guest', 'participant who deleted it'];

function msgExpected(string $kind, int $success, string $viewer): array
{
    return match ($viewer) {
        'participant' => [$success, null],
        'guest' => [401, 'unauthenticated'],
        'other member', 'participant who blocked the other', 'participant the other blocked', 'participant who deleted it' => [404, 'not_found'],
        'participant restricted from messaging' => $kind === 'reach' ? [403, 'account_restricted'] : [$success, null],
        'unverified participant' => $kind === 'read' ? [$success, null] : [403, 'email_not_verified'],
    };
}

beforeEach(function () {
    msgFlags();
    Storage::fake('public');
    Storage::fake('local');
});

it('holds the matrix on every route', function (string $route, string $viewer) {
    [$method, $template, $success, $kind] = MSG_ROUTES[$route];
    $lukas = ntfMember('lukas.sc');
    $jann = ntfMember('jann.ptrs');
    $message = msgStart($jann, $lukas, 'Moin, Treffen am Samstag?');
    $id = $message->conversation_id;

    $actor = match ($viewer) {
        'guest' => null,
        'other member' => User::factory()->create(),
        'participant who blocked the other' => tap($lukas, fn () => socBlock($lukas, $jann)),
        'participant the other blocked' => tap($lukas, fn () => socBlock($jann, $lukas)),
        'participant restricted from messaging' => tap($lukas)->forceFill(['restrictions' => [RestrictionType::Messaging->value => ['until' => null]]]),
        'unverified participant' => tap($lukas)->forceFill(['email_verified_at' => null]),
        'participant who deleted it' => tap($lukas, fn () => msgSide($id, $lukas)->forceFill(['deleted_at' => now()])->save()),
        default => $lukas,
    };
    $actor?->save();

    if ($actor !== null) {
        Sanctum::actingAs($actor->refresh());
    }

    $uri = '/api/v1/'.str_replace(['{c}', '{m}'], [$id, $message->id], $template);
    $body = match ($route) {
        'send' => ['type' => 'text', 'body' => 'Klar, bin dabei.', 'client_id' => (string) Str::uuid()],
        'react' => ['key' => 'fire'],
        'read' => ['message_id' => $message->id],
        'organise' => ['pinned' => true],
        default => [],
    };

    $response = $route === 'upload'
        ? $this->post($uri, ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])
        : $this->json($method, $uri, $body);

    [$status, $code] = msgExpected($kind, $success, $viewer);
    $response->assertStatus($status);

    if ($code !== null) {
        $response->assertJsonPath('code', $code);
    }
})->with(array_keys(MSG_ROUTES))->with(MSG_VIEWERS);

it('lets only the recipient of a request accept it or decline it', function (string $action, string $viewer, int $status) {
    $max = ntfMember('max.e46');
    $lukas = ntfMember('lukas.sc');
    $id = msgStart($max, $lukas, chat: false)->conversation_id;
    $actor = match ($viewer) {
        'recipient' => $lukas,
        'sender' => $max,
        'other member' => User::factory()->create(),
        'blocked recipient' => tap($lukas, fn () => socBlock($max, $lukas)),
        'unverified recipient' => tap($lukas)->forceFill(['email_verified_at' => null]),
        default => null,
    };
    $actor?->save();

    if ($actor !== null) {
        Sanctum::actingAs($actor->refresh());
    }

    $expected = $viewer === 'recipient' ? ($action === 'accept' ? 200 : 204) : $status;
    $this->postJson("/api/v1/conversations/$id/$action")->assertStatus($expected);
})->with(['accept', 'decline'])->with([
    'recipient' => ['recipient', 0],
    'sender' => ['sender', 404],
    'other member' => ['other member', 404],
    'blocked recipient' => ['blocked recipient', 404],
    'unverified recipient' => ['unverified recipient', 403],
    'guest' => ['guest', 401],
]);

it('answers a guest 401 on the inbox, the start and the badge', function (string $method, string $uri) {
    $this->json($method, $uri)->assertUnauthorized();
})->with([
    ['GET', '/api/v1/conversations'],
    ['POST', '/api/v1/conversations'],
    ['POST', '/api/v1/broadcasting/auth'],
]);

it('answers 404 for an id that is no ULID', function () {
    msgActAs(ntfMember('lukas.sc'));

    $this->getJson('/api/v1/conversations/abc')->assertNotFound();
    $this->deleteJson('/api/v1/messages/abc')->assertNotFound();
    $this->getJson('/api/v1/conversations/01JAAAAAAAAAAAAAAAAAAAAAAA')->assertNotFound();
});

it('lists only the member own conversations', function () {
    $lukas = ntfMember('lukas.sc');
    msgStart(ntfMember('jann.ptrs'), ntfMember('kenji.r34'));
    msgActAs($lukas);

    $this->getJson('/api/v1/conversations')->assertOk()->assertJsonCount(0, 'data');
    $this->getJson('/api/v1/conversations?folder=requests')->assertOk()->assertJsonCount(0, 'data');
});
