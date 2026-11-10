<?php

use App\Http\RateLimits;
use App\Models\Block;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleSpec;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SignatureTestHelpers.php';

/**
 * M2.7 [SIG sig.compare] GET compare?a=&b= (m2.7-contract §1, VEH-06): both builds visible to the viewer or 404 for the whole comparison.
 */
beforeEach(function () {
    seedModSchema();
    sigFlag('sig.compare');
    $this->a = publishedVehicle(null, ['model_year' => 2002, 'color' => 'Bayside Blue']);
    $this->b = publishedVehicle(null, ['model_year' => 2022, 'color' => null]);
    VehicleSpec::factory()->create(['vehicle_id' => $this->a->id, 'power_value' => 280, 'power_unit' => 'ps', 'power_ps' => 280, 'torque_nm' => 392, 'drivetrain' => 'all']);
    VehicleSpec::factory()->create(['vehicle_id' => $this->b->id, 'power_value' => 510, 'power_unit' => 'ps', 'power_ps' => 510, 'torque_nm' => 650, 'drivetrain' => 'all']);
    modIn($this->a, 'suspension', ['type' => 'coilover'], ['title' => 'KW V3', 'sort' => 1]);
    modIn($this->a, 'exhaust', [], ['title' => 'HKS Hi-Power', 'sort' => 2]);
    modIn($this->b, 'suspension', ['type' => 'air'], ['title' => 'Air Lift', 'sort' => 1]);
    modIn($this->b, 'wheels_tires', ['diameter' => 20], ['title' => 'BBS FI-R', 'sort' => 2]);
    $this->withHeader('Accept-Language', 'de');
});

function sigCompare(Vehicle $a, Vehicle $b): mixed
{
    return test()->getJson('/api/v1/compare?'.http_build_query(['a' => $a->slug, 'b' => $b->slug]));
}

it('puts both builds side by side: cards, merged spec rows with their differences, mods per category', function () {
    $data = sigCompare($this->a, $this->b)->assertOk()->json('data');

    expect(array_keys($data))->toBe(['a', 'b', 'specs', 'mods'])
        ->and($data['a']['slug'])->toBe($this->a->slug)
        ->and($data['b']['slug'])->toBe($this->b->slug)
        ->and($data['a'])->toHaveKeys(['full_title', 'subline_parts', 'cover', 'spec_strip']);

    $rows = collect($data['specs'])->flatMap(fn (array $group) => collect($group['rows'])->keyBy('key'))->all();

    expect(array_column($data['specs'], 'key'))->toContain('vehicle', 'power', 'drivetrain')
        ->and($rows['model_year'])->toMatchArray(['a' => '2002', 'b' => '2022', 'differs' => true])
        ->and($rows['power']['a'])->toContain('280')->and($rows['power']['b'])->toContain('510')
        ->and($rows['drivetrain']['differs'])->toBeFalse()
        // A row only one build has: the other side is null.
        ->and($rows['color'])->toMatchArray(['a' => 'Bayside Blue', 'b' => null, 'differs' => true]);

    $mods = collect($data['mods'])->keyBy('key');
    expect($mods->keys()->all())->toBe(['wheels_tires', 'suspension', 'exhaust'])
        ->and(array_column($mods['suspension']['a'], 'title'))->toBe(['KW V3'])
        ->and(array_column($mods['suspension']['b'], 'title'))->toBe(['Air Lift'])
        ->and($mods['exhaust']['b'])->toBe([])
        ->and($mods['wheels_tires']['a'])->toBe([])
        ->and($mods['suspension']['a'][0])->toHaveKeys(['id', 'title', 'summary_line', 'status_label']);
});

it('answers in the viewer\'s language and power unit', function () {
    $viewer = User::factory()->create(['power_display' => 'hp']);
    Sanctum::actingAs($viewer);

    $data = $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/compare?'.http_build_query(['a' => $this->a->slug, 'b' => $this->b->slug]))->assertOk()->json('data');
    $power = collect($data['specs'])->firstWhere('key', 'power');

    expect($power['label'])->toBe('Power')->and($power['rows'][0]['b'])->toContain('hp');
});

it('answers 404 for the whole comparison when the viewer may not see either build', function (Closure $hide) {
    $viewer = $hide($this->a, $this->b);

    if ($viewer instanceof User) {
        Sanctum::actingAs($viewer);
    }

    sigCompare($this->a, $this->b)->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
    sigCompare($this->b, $this->a)->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
})->with([
    'private' => [fn (Vehicle $a) => $a->forceFill(['visibility' => 'private'])->save() && false],
    'draft' => [fn (Vehicle $a) => $a->forceFill(['status' => 'draft'])->save() && false],
    'deleted' => [fn (Vehicle $a) => $a->delete() && false],
    'owner suspended' => [fn (Vehicle $a) => $a->owner->forceFill(['status' => 'suspended'])->save() && false],
    'owner blocked the viewer' => [function (Vehicle $a): User {
        $viewer = User::factory()->create();
        Block::factory()->create(['blocker_id' => $a->owner_id, 'blocked_id' => $viewer->id]);

        return $viewer;
    }],
    'viewer blocked the owner' => [function (Vehicle $a): User {
        $viewer = User::factory()->create();
        Block::factory()->create(['blocker_id' => $viewer->id, 'blocked_id' => $a->owner_id]);

        return $viewer;
    }],
    'unknown' => [fn (Vehicle $a) => $a->forceFill(['public_id' => 'zzzzzzzz'])->save() && false],
]);

it('lets the owner compare their own private build, and unlisted builds compare like their page', function () {
    $this->a->forceFill(['visibility' => 'private'])->save();
    $this->b->forceFill(['visibility' => 'unlisted'])->save();
    Sanctum::actingAs($this->a->owner);

    sigCompare($this->a, $this->b)->assertOk();
});

it('validates both slugs and refuses the same build twice', function (string $query, string $field) {
    $this->getJson('/api/v1/compare?'.$query)->assertUnprocessable()->assertJsonValidationErrors($field);
})->with([
    'no a' => ['b=x', 'a'],
    'no b' => ['a=x', 'b'],
    'array' => ['a[]=x&b=y', 'a'],
    'punctuation' => ['a=%3Cscript%3E&b=y', 'a'],
]);

it('says why the same build cannot be compared, in both languages', function () {
    $query = http_build_query(['a' => $this->a->slug, 'b' => strtoupper($this->a->public_id)]);

    $this->getJson('/api/v1/compare?'.$query)->assertUnprocessable()->assertJsonPath('errors.b.0', 'Wähle zum Vergleichen einen anderen Build.');
    $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/compare?'.$query)->assertJsonPath('errors.b.0', 'Choose a different build to compare with.');
});

it('does not exist while the flag is off', function () {
    sigFlag('sig.compare', false);

    sigCompare($this->a, $this->b)->assertNotFound()->assertJsonPath('code', 'feature_disabled');
});

it('revalidates with its ETag and sits on the browse limit', function () {
    config(['speedclub.rate_limits.browse.max' => 2]);
    app(RateLimits::class)->register();
    $url = '/api/v1/compare?'.http_build_query(['a' => $this->a->slug, 'b' => $this->b->slug]);
    $etag = $this->getJson($url)->assertOk()->headers->get('ETag');

    $this->withHeader('If-None-Match', (string) $etag)->getJson($url)->assertStatus(304);
    $this->getJson($url)->assertStatus(429)->assertJsonPath('code', 'rate_limited');
});
