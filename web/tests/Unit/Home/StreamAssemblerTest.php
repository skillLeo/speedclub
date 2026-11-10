<?php

use App\Services\Home\StreamAssembler;
use App\Services\Home\StreamCursor;
use App\Services\Home\StreamSource;
use App\Services\Home\StreamState;
use App\Services\Home\StreamUpdate;
use App\Services\Home\StreamVehicle;

/**
 * The Für dich rules (M2.2), against an in-memory source: diversity of owners, update rows, what the page above shows, and pages that read
 * one after another as the stream read at once, through the real signed cursor.
 */
final class ArraySource implements StreamSource
{
    /** @var list<StreamVehicle> */
    public array $vehicles = [];

    /** @var list<StreamUpdate> */
    public array $updates = [];

    /** @var array<string, true> */
    public array $hidden = [];

    /**
     * @param  list<array{0: string, 1: string}>  $vehicles  [id suffix, owner] in rank order
     * @param  list<array{0: string, 1: string, 2: string}>  $updates  [id suffix, vehicle suffix, owner] newest first
     */
    public function __construct(array $vehicles, array $updates = [])
    {
        $count = count($vehicles);

        foreach ($vehicles as $index => [$id, $owner]) {
            $this->vehicles[] = new StreamVehicle(asmId('v', $id), asmId('o', $owner), sprintf('%d.000000', $count - $index), '2026-11-01 12:00:00');
        }

        foreach ($updates as $index => [$id, $vehicle, $owner]) {
            $this->updates[] = new StreamUpdate(asmId('u', $id), asmId('v', $vehicle), asmId('o', $owner), sprintf('2026-11-%02d 12:00:00', 28 - $index));
        }
    }

    public function vehiclesAfter(?array $after, array $exclude, int $limit): array
    {
        $rows = array_filter($this->vehicles, fn (StreamVehicle $vehicle): bool => ! isset($this->hidden[$vehicle->id]) && ! in_array($vehicle->id, $exclude, true)
            && ($after === null || [(float) $vehicle->score, $vehicle->changedAt, $vehicle->id] < [(float) $after[0], $after[1], $after[2]]));

        return array_slice(array_values($rows), 0, $limit);
    }

    public function vehiclesByIds(array $ids): array
    {
        return array_values(array_filter($this->vehicles, fn (StreamVehicle $vehicle): bool => in_array($vehicle->id, $ids, true) && ! isset($this->hidden[$vehicle->id])));
    }

    public function updatesAfter(?array $after, array $exclude, int $limit): array
    {
        $rows = array_filter($this->updates, fn (StreamUpdate $update): bool => ! in_array($update->id, $exclude, true)
            && ($after === null || [$update->at, $update->id] < [$after[0], $after[1]]));

        return array_slice(array_values($rows), 0, $limit);
    }
}

/**
 * A valid ULID-shaped id ending in the given suffix, so the signed cursor accepts it.
 */
function asmId(string $kind, string $suffix): string
{
    if ($kind === 'o') {
        // Owners travel as StreamCursor::ownerKey(): 16 hex digits.
        return str_pad(bin2hex($suffix), 16, '0', STR_PAD_LEFT);
    }

    $prefix = ['v' => '01k0v', 'u' => '01k0x'][$kind];

    return $prefix.str_pad(strtolower($suffix), 21, '0', STR_PAD_LEFT);
}

/**
 * Items as "v:a@o:x" or "u:a@o:x" for readable expectations.
 *
 * @param  list<StreamVehicle|StreamUpdate>  $items
 * @return list<string>
 */
function asmLabels(array $items): array
{
    return array_map(function (StreamVehicle|StreamUpdate $item): string {
        $id = ltrim(substr($item->id, 5), '0');
        $owner = (string) hex2bin(ltrim($item->ownerId, '0'));

        return ($item instanceof StreamVehicle ? 'v:' : 'u:').$id.'@'.$owner;
    }, $items);
}

/**
 * Reads the whole stream in pages of $size, through the encoded cursor.
 *
 * @return list<StreamVehicle|StreamUpdate>
 */
function asmReadAll(StreamSource $source, int $size, ?StreamState $start = null, int $maxPages = 100): array
{
    $assembler = new StreamAssembler;
    $state = $start ?? new StreamState;
    $items = [];

    for ($page = 0; $page < $maxPages; $page++) {
        $result = $assembler->page($source, $state, $size);
        $items = [...$items, ...$result['items']];

        if ($result['state'] === null) {
            return $items;
        }

        $state = StreamCursor::decode(StreamCursor::encode($result['state']));
        expect($state)->not->toBeNull();
    }

    throw new RuntimeException('The stream did not end.');
}

/**
 * @param  list<StreamVehicle|StreamUpdate>  $items
 */
function asmLongestRun(array $items): int
{
    $longest = 0;
    $run = 0;
    $last = null;

    foreach ($items as $item) {
        $run = $item->ownerId === $last ? $run + 1 : 1;
        $last = $item->ownerId;
        $longest = max($longest, $run);
    }

    return $longest;
}

it('keeps rank order when owners already alternate', function () {
    $source = new ArraySource([['1', 'a'], ['2', 'b'], ['3', 'a'], ['4', 'b']]);

    expect(asmLabels(asmReadAll($source, 20)))->toBe(['v:1@a', 'v:2@b', 'v:3@a', 'v:4@b']);
});

it('lets at most two items of one owner follow each other, and brings held-back builds back as soon as it may', function () {
    $source = new ArraySource([['1', 'a'], ['2', 'a'], ['3', 'a'], ['4', 'a'], ['5', 'b'], ['6', 'c'], ['7', 'a']]);

    expect(asmLabels(asmReadAll($source, 20)))->toBe(['v:1@a', 'v:2@a', 'v:5@b', 'v:3@a', 'v:4@a', 'v:6@c', 'v:7@a']);
});

it('gives way at the end, when no other owner is left', function () {
    $source = new ArraySource([['1', 'a'], ['2', 'b'], ['3', 'a'], ['4', 'a'], ['5', 'a']]);

    expect(asmLabels(asmReadAll($source, 20)))->toBe(['v:1@a', 'v:2@b', 'v:3@a', 'v:4@a', 'v:5@a']);
});

it('gives way after max_deferred held-back builds, so one owner cannot stall a page', function () {
    $rows = array_map(fn (int $i): array => [(string) $i, 'a'], range(1, 15));
    $rows[] = ['99', 'b'];
    $items = asmReadAll(new ArraySource($rows), 20);

    expect(count($items))->toBe(16)
        ->and(array_slice(asmLabels($items), 0, 3))->toBe(['v:1@a', 'v:2@a', 'v:3@a']);
});

it('puts one update row after every three cards, newest first, never of one of those three cards', function () {
    $source = new ArraySource(
        [['1', 'a'], ['2', 'b'], ['3', 'c'], ['4', 'd'], ['5', 'e'], ['6', 'f'], ['7', 'g']],
        [['10', '3', 'c'], ['11', '9', 'x'], ['12', '8', 'y']],
    );

    expect(asmLabels(asmReadAll($source, 20)))->toBe(['v:1@a', 'v:2@b', 'v:3@c', 'u:11@x', 'v:4@d', 'v:5@e', 'v:6@f', 'u:12@y', 'v:7@g']);
});

it('holds an update row back while it would make a third item of its owner', function () {
    $source = new ArraySource(
        [['1', 'a'], ['2', 'b'], ['3', 'b'], ['4', 'c'], ['5', 'd']],
        [['10', '9', 'b']],
    );

    expect(asmLabels(asmReadAll($source, 20)))->toBe(['v:1@a', 'v:2@b', 'v:3@b', 'v:4@c', 'u:10@b', 'v:5@d']);
});

it('leaves out what the page above already shows', function () {
    $source = new ArraySource([['1', 'a'], ['2', 'b'], ['3', 'c'], ['4', 'd']], [['10', '7', 'x'], ['11', '8', 'y']]);
    $start = new StreamState(excludedVehicles: [asmId('v', '1'), asmId('v', '3')], excludedUpdates: [asmId('u', '10')]);

    expect(asmLabels(asmReadAll($source, 20, $start)))->toBe(['v:2@b', 'v:4@d']);

    $source = new ArraySource([['1', 'a'], ['2', 'b'], ['3', 'c'], ['4', 'd']], [['10', '7', 'x'], ['11', '8', 'y']]);
    expect(asmLabels(asmReadAll($source, 20, new StreamState(excludedVehicles: [asmId('v', '1')], excludedUpdates: [asmId('u', '10')]))))
        ->toBe(['v:2@b', 'v:3@c', 'v:4@d', 'u:11@y']);
});

it('reads the same stream in pages of any size as at once, diversity and update rows carried across every boundary', function (int $size) {
    $owners = ['a', 'a', 'a', 'b', 'a', 'a', 'c', 'c', 'c', 'c', 'd', 'a', 'e', 'e', 'e', 'f', 'a', 'a', 'a', 'a', 'g', 'b', 'b', 'b', 'h'];
    $vehicles = array_map(fn (int $i, string $owner): array => [(string) ($i + 1), $owner], array_keys($owners), $owners);
    $updates = [['50', '2', 'a'], ['51', '30', 'z'], ['52', '7', 'c'], ['53', '31', 'a'], ['54', '32', 'y'], ['55', '33', 'c'], ['56', '34', 'x']];

    $atOnce = asmReadAll(new ArraySource($vehicles, $updates), 100);
    $paged = asmReadAll(new ArraySource($vehicles, $updates), $size);

    expect(asmLabels($paged))->toBe(asmLabels($atOnce))
        ->and(asmLongestRun($paged))->toBeLessThanOrEqual(2)
        ->and(count(array_filter($paged, fn ($item): bool => $item instanceof StreamVehicle)))->toBe(count($owners))
        ->and(count(array_unique(asmLabels($paged))))->toBe(count($paged));
})->with([1, 2, 3, 4, 5, 7, 20]);

it('ends with a null state exactly when nothing is left', function () {
    $source = new ArraySource([['1', 'a'], ['2', 'b'], ['3', 'c']]);
    $assembler = new StreamAssembler;

    $first = $assembler->page($source, new StreamState, 2);
    $second = $assembler->page($source, $first['state'] ?? new StreamState, 2);

    expect(count($first['items']))->toBe(2)->and($first['state'])->not->toBeNull()
        ->and(asmLabels($second['items']))->toBe(['v:3@c'])->and($second['state'])->toBeNull()
        ->and($assembler->page(new ArraySource([]), new StreamState, 5))->toBe(['items' => [], 'state' => null]);
});

it('drops a held-back build that went private between two pages', function () {
    $source = new ArraySource([['1', 'a'], ['2', 'a'], ['3', 'a'], ['4', 'b'], ['5', 'c']]);
    $assembler = new StreamAssembler;

    $first = $assembler->page($source, new StreamState, 3);
    expect(asmLabels($first['items']))->toBe(['v:1@a', 'v:2@a', 'v:4@b'])
        ->and($first['state']?->deferred)->toContain(asmId('v', '3'));

    $source->hidden[asmId('v', '3')] = true;

    expect(asmLabels($assembler->page($source, $first['state'] ?? new StreamState, 10)['items']))->toBe(['v:5@c']);
});

it('never puts an update row right before a card of its own build: the card already shows it (M2.3 follow-up)', function (int $size) {
    $source = new ArraySource(
        [['1', 'a'], ['2', 'b'], ['3', 'c'], ['4', 'd'], ['5', 'e'], ['6', 'f'], ['7', 'g']],
        [['10', '4', 'd'], ['11', '9', 'x'], ['12', '8', 'y']],
    );
    $items = asmReadAll($source, $size);

    expect(asmLabels($items))->toBe(['v:1@a', 'v:2@b', 'v:3@c', 'u:11@x', 'v:4@d', 'v:5@e', 'v:6@f', 'u:12@y', 'v:7@g']);

    foreach ($items as $index => $item) {
        $next = $items[$index + 1] ?? null;
        $previous = $items[$index - 1] ?? null;

        if ($item instanceof StreamUpdate) {
            expect($next?->id)->not->toBe($item->vehicleId)
                ->and($previous?->id)->not->toBe($item->vehicleId);
        }
    }
})->with([1, 2, 3, 4, 20]);

it('looks ahead past the diversity rule: the card that really follows the row decides', function () {
    // After 1a 2b 3b rule 2 holds 4b back, so by itself 5c would come next. After an update row of owner c, though, 4b may follow
    // again, so the row of 5c is not next to its card and stays.
    $source = new ArraySource(
        [['1', 'a'], ['2', 'b'], ['3', 'b'], ['4', 'b'], ['5', 'c'], ['6', 'd']],
        [['10', '5', 'c'], ['11', '9', 'x']],
    );

    expect(asmLabels(asmReadAll($source, 20)))->toBe(['v:1@a', 'v:2@b', 'v:3@b', 'u:10@c', 'v:4@b', 'v:5@c', 'v:6@d', 'u:11@x']);

    // When 5c does follow the row (4b is another owner's), the row of 5c is skipped for good.
    $source = new ArraySource(
        [['1', 'a'], ['2', 'b'], ['3', 'b'], ['5', 'c'], ['6', 'd'], ['7', 'e'], ['8', 'f']],
        [['10', '5', 'c'], ['11', '9', 'x']],
    );

    expect(asmLabels(asmReadAll($source, 20)))->toBe(['v:1@a', 'v:2@b', 'v:3@b', 'u:11@x', 'v:5@c', 'v:6@d', 'v:7@e', 'v:8@f']);
});
