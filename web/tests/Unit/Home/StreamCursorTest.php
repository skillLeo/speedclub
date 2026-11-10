<?php

use App\Services\Home\StreamCursor;
use App\Services\Home\StreamState;

$id = fn (string $suffix): string => '01k0v'.str_pad($suffix, 21, '0', STR_PAD_LEFT);

it('round-trips a state', function () use ($id) {
    $state = new StreamState(['0.731200', '2026-11-08 09:00:00', $id('1')], [$id('2'), $id('3')], StreamCursor::ownerKey($id('9')), 2, ['2026-11-08 09:15:00', $id('4')], 1, [$id('1')], [$id('5')], [$id('6')]);

    expect(StreamCursor::decode(StreamCursor::encode($state)))->toEqual($state)
        ->and(StreamCursor::decode(StreamCursor::encode(new StreamState)))->toEqual(new StreamState);
});

it('refuses a cursor that was changed, cut, forged or signed with another key', function () use ($id) {
    $cursor = StreamCursor::encode(new StreamState(['0.500000', '2026-11-08 09:00:00', $id('1')]));
    [$body, $signature] = explode('.', $cursor);
    $forged = rtrim(strtr(base64_encode((string) json_encode(['p' => ['9.000000', '2026-11-08 09:00:00', $id('1')], 'd' => [], 'o' => null, 'r' => 0, 'u' => null, 's' => 0, 'l' => [], 'x' => [], 'y' => []])), '+/', '-_'), '=');

    expect(StreamCursor::decode($body.'.'.$signature.'x'))->toBeNull()
        ->and(StreamCursor::decode($body))->toBeNull()
        ->and(StreamCursor::decode($forged.'.'.$signature))->toBeNull()
        ->and(StreamCursor::decode(''))->toBeNull()
        ->and(StreamCursor::decode('eyJfcG9pbnRzVG9OZXh0SXRlbXMiOnRydWV9'))->toBeNull();

    config(['app.key' => 'base64:'.base64_encode(str_repeat('k', 32))]);
    expect(StreamCursor::decode($cursor))->toBeNull();
});

it('refuses signed payloads of the wrong shape', function (array $payload) {
    $body = rtrim(strtr(base64_encode((string) json_encode($payload)), '+/', '-_'), '=');
    $signature = rtrim(strtr(base64_encode(substr(hash_hmac('sha256', 'feed-cursor|'.$body, config()->string('app.key'), true), 0, 16)), '+/', '-_'), '=');

    expect(StreamCursor::decode($body.'.'.$signature))->toBeNull();
})->with([
    'not an id' => [['p' => null, 'd' => ["1' OR 1=1"], 'o' => null, 'r' => 0, 'u' => null, 's' => 0, 'l' => [], 'x' => [], 'y' => []]],
    'score as a number' => [['p' => [0.5, '2026-11-08 09:00:00', '01k0v000000000000000000001'], 'd' => [], 'o' => null, 'r' => 0, 'u' => null, 's' => 0, 'l' => [], 'x' => [], 'y' => []]],
    'too many ids' => [['p' => null, 'd' => array_fill(0, 40, '01k0v000000000000000000001'), 'o' => null, 'r' => 0, 'u' => null, 's' => 0, 'l' => [], 'x' => [], 'y' => []]],
    'negative run' => [['p' => null, 'd' => [], 'o' => null, 'r' => -1, 'u' => null, 's' => 0, 'l' => [], 'x' => [], 'y' => []]],
    'keys missing' => [['p' => null]],
    'position without the change time' => [['p' => ['0.500000', '01k0v000000000000000000001'], 'd' => [], 'o' => null, 'r' => 0, 'u' => null, 's' => 0, 'l' => [], 'x' => [], 'y' => []]],
]);
