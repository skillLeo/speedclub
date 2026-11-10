<?php

use App\Models\ModerationCase;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Admin\Search;

require_once __DIR__.'/Helpers.php';

/**
 * ADM-07 search (contract §1.7): grouped, each group behind its atom, at most five hits, e-mail only with members.view_pii.
 */
function m31Search(string $role, string $q): array
{
    return collect(app(Search::class)->search(m31Staff($role), $q))->mapWithKeys(fn (array $group): array => [$group['group'] => $group['items']])->all();
}

it('finds members by username prefix, at most five, without their address', function () {
    foreach (range(1, 7) as $i) {
        User::factory()->create(['username' => "turbo$i", 'display_name' => "Turbo $i"]);
    }
    User::factory()->create(['username' => 'diesel']);

    $members = m31Search('support', 'turbo')['members'];

    expect($members)->toHaveCount(5)
        ->and($members[0])->toMatchArray(['title' => '@turbo1', 'subtitle' => 'Turbo 1', 'url' => null])
        ->and((string) json_encode($members))->not->toContain('@speedclub')
        ->and(m31Search('support', '@turbo1')['members'][0]['title'])->toBe('@turbo1');
});

it('finds a member by exact address only with members.view_pii', function () {
    $member = User::factory()->create(['email' => 'lena@example.de', 'username' => 'lena.gti']);

    expect(m31Search('support', 'Lena@Example.de')['members'][0]['id'])->toBe($member->id)
        ->and(m31Search('analyst', 'lena@example.de'))->toBe([])
        ->and(m31Search('support', 'lena@example'))->toBe([]);
});

it('finds vehicles by slug or public id, QR codes by code and cases by id', function () {
    $vehicle = Vehicle::factory()->published()->create();
    $qr = QrCode::factory()->create();
    $case = ModerationCase::factory()->create();

    expect(m31Search('owner', $vehicle->slug)['vehicles'][0]['id'])->toBe($vehicle->id)
        ->and(m31Search('owner', strtolower($vehicle->public_id))['vehicles'][0]['id'])->toBe($vehicle->id)
        ->and(m31Search('owner', substr($qr->code, 0, 4).'-'.substr($qr->code, 4))['qr'][0]['id'])->toBe($qr->id)
        ->and(m31Search('owner', strtoupper($case->id))['cases'][0]['id'])->toBe($case->id);
});

it('leaves out every group the role may not see', function () {
    $case = ModerationCase::factory()->create();
    $vehicle = Vehicle::factory()->published()->create();

    expect(m31Search('content_editor', $case->id))->toBe([])
        ->and(m31Search('support', $case->id))->toBe([])
        ->and(m31Search('content_editor', $vehicle->public_id))->toBe([])
        ->and(m31Search('moderator', $case->id)['cases'][0]['id'])->toBe($case->id);
});

it('ignores input past 120 characters and answers nothing to one character', function () {
    User::factory()->create(['username' => 'ab']);

    expect(m31Search('owner', 'a'))->toBe([])
        ->and(m31Search('owner', 'ab'.str_repeat('x', 200)))->toBe([])
        ->and(m31Search('owner', '%'))->toBe([])
        ->and(m31Search('owner', 'a_'))->toBe([]);
});
