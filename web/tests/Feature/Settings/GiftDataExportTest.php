<?php

use App\Models\Badge;
use App\Models\CarOfTheDay;
use App\Models\InviteCode;
use App\Models\Spot;
use App\Models\User;
use App\Models\UserBadge;
use App\Models\UserSetProgress;
use App\Models\Wrapped;
use App\Models\XpEvent;
use App\Services\DataExport\ExportContents;
use Database\Seeders\BadgeSeeder;
use Database\Seeders\DexSetSeeder;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/../Gift/GiftTestHelpers.php';

/**
 * GDPR Art. 15/20 export of the Phase 5 gifts (M5.9b–e): spots.json, spots_of_my_cars.json, progress.json, invites.json,
 * car_of_the_day.json, wrapped.json and the Build Score in vehicles.json. Own data only; other members only as the app shows them
 * (DEX-06 spotters by their "Meine Spots zeigen", invitees while public, else "ein Mitglied"); never coordinates, never the install key.
 */
function giftExport(User $user, bool $forStaff = false): array
{
    return json_decode((string) json_encode(app(ExportContents::class)->documents($user->fresh() ?? $user, $forStaff)), true);
}

beforeEach(function () {
    $this->seed(DexSetSeeder::class);
    $this->seed(BadgeSeeder::class);
});

it('lists the gift files', function () {
    expect(array_keys(giftExport(giftMember())))->toContain('spots.json', 'spots_of_my_cars.json', 'progress.json', 'invites.json', 'car_of_the_day.json', 'wrapped.json');
});

it('exports the member\'s own spots with city and Bundesland, removed ones marked, the Dex progress and the foils', function () {
    $member = giftMember(['locale' => 'de']);
    [$car] = dexCar(giftMember());
    $car->forceFill(['dex_number' => 87])->save();
    $essen = dexCity('Essen');
    Spot::factory()->create(['vehicle_id' => $car->id, 'spotter_id' => $member->id, 'city_id' => $essen->id, 'bundesland' => 'NW', 'counted' => true, 'is_first_three' => true]);
    Spot::factory()->create(['vehicle_id' => $car->id, 'spotter_id' => $member->id, 'counted' => true])->delete();
    Spot::factory()->create(['vehicle_id' => $car->id, 'spotter_id' => giftMember()->id, 'counted' => true]);
    (new UserSetProgress)->forceFill(['user_id' => $member->id, 'set_key' => 'saison', 'period' => '2026', 'progress' => 3, 'target' => 25, 'completed_at' => null])->save();

    $spots = giftExport($member)['spots.json'];

    expect($spots['spots'])->toHaveCount(2)
        ->and($spots['spots'][0])->toMatchArray(['vehicle' => $car->public_id, 'dex_number' => 87, 'city' => 'Essen', 'bundesland' => 'NW', 'counted' => true, 'first_spotter' => true, 'removed' => false])
        ->and($spots['spots'][1]['removed'])->toBeTrue()
        ->and($spots['dex']['found'])->toBe(1)
        ->and($spots['dex']['sets'])->toBe([['set' => 'saison', 'name' => 'Saison', 'period' => '2026', 'progress' => 3, 'target' => 25, 'completed_at' => null]])
        ->and($spots['first_spotter_foils'])->toBe(1);
});

it('exports what DEX-06 shows the owner: day cities only, spotters by their own choice, the switches; staff see a count', function () {
    $owner = giftMember();
    [$car] = dexCar($owner);
    $car->forceFill(['spotting_paused' => true])->save();
    $named = giftMember(['username' => 'lena.spot', 'display_name' => 'Lena']);
    $shy = giftMember(['show_my_spots' => false]);
    Spot::factory()->create(['vehicle_id' => $car->id, 'spotter_id' => $named->id, 'city_id' => dexCity('Essen')->id, 'counted' => true]);
    Spot::factory()->create(['vehicle_id' => $car->id, 'spotter_id' => $shy->id, 'city_id' => dexCity('Bochum')->id, 'counted' => true, 'is_night' => true]);
    // DEX-06 names spotters only once the owner alert window has passed (nothing live, CR-P5G-01); the export shows the same.
    $this->travel(config()->integer('speedclub.dex.alerts.window_hours') * 60 + 1)->minutes();

    $mine = giftExport($owner)['spots_of_my_cars.json'][0];

    expect($mine)->toMatchArray(['vehicle' => $car->public_id, 'ghost_mode' => false, 'spotting_paused' => true, 'hide_spot_cities' => false, 'total' => 2, 'unique_spotters' => 2, 'cities_count' => 1])
        ->and($mine['cities'])->toBe([['name' => 'Essen', 'count' => 1]])
        ->and($mine['recent_spotters'])->toContain(['username' => 'lena.spot', 'display_name' => 'Lena'], ['anonymous' => true])
        ->and(json_encode($mine))->not->toContain($shy->username)
        ->and(giftExport($owner, forStaff: true)['spots_of_my_cars.json'][0]['recent_spotters'])->toBe(['count' => 2]);

    $car->forceFill(['hide_spot_cities' => true])->save();
    expect(giftExport($owner)['spots_of_my_cars.json'][0])->toMatchArray(['cities' => [], 'cities_count' => 0]);
});

it('exports XP without source ids, level, badges and the founding number', function () {
    $member = giftMember(['xp' => 600, 'founding_number' => 42, 'locale' => 'en']);
    XpEvent::factory()->create(['user_id' => $member->id, 'ref_id' => 'secret-ref-of-other-content']);
    UserBadge::factory()->create(['user_id' => $member->id, 'badge_key' => 'crew-starter']);

    $progress = giftExport($member)['progress.json'];

    expect($progress)->toMatchArray(['xp' => 600, 'level' => 4, 'title' => 'Parts Hunter', 'founding_number' => 42])
        ->and($progress['xp_events'][0])->toHaveKeys(['type', 'points', 'capped', 'day', 'created_at'])
        ->and(json_encode($progress))->not->toContain('secret-ref-of-other-content')
        ->and($progress['badges'][0])->toMatchArray(['key' => 'crew-starter', 'name' => Badge::query()->findOrFail('crew-starter')->name_en]);
});

it('exports invite codes with a public invitee by username and anybody else as "ein Mitglied", and the code the member joined with', function () {
    $member = giftMember(['locale' => 'de']);
    $public = giftMember(['username' => 'neuling']);
    $hidden = User::factory()->suspended()->create();
    InviteCode::factory()->create(['code' => 'AAAAAAA1', 'inviter_id' => $member->id, 'accepted_by' => $public->id, 'accepted_at' => now()]);
    InviteCode::factory()->create(['code' => 'AAAAAAA2', 'inviter_id' => $member->id, 'accepted_by' => $hidden->id, 'accepted_at' => now()]);
    InviteCode::factory()->create(['code' => 'AAAAAAA3', 'inviter_id' => $member->id]);
    $inviter = giftMember(['username' => 'crewlead']);
    InviteCode::factory()->create(['code' => 'BBBBBBB1', 'inviter_id' => $inviter->id, 'accepted_by' => $member->id, 'accepted_at' => now()]);

    $invites = giftExport($member)['invites.json'];

    expect(collect($invites['codes'])->pluck('accepted_by', 'code')->all())->toBe(['AAAAAAA1' => '@neuling', 'AAAAAAA2' => 'ein Mitglied', 'AAAAAAA3' => null])
        ->and($invites['joined_with'])->toMatchArray(['code' => 'BBBBBBB1', 'invited_by' => '@crewlead'])
        ->and(json_encode($invites))->not->toContain((string) $hidden->username);

    giftBlock($member, $public);
    expect(giftExport($member)['invites.json']['codes'][0]['accepted_by'])->toBe('ein Mitglied');
});

it('exports the Car of the Day features of the member\'s cars only, published ones', function () {
    $owner = giftMember();
    $car = giftCar($owner, 600);
    CarOfTheDay::factory()->create(['day' => '2026-07-15', 'vehicle_id' => $car->id, 'story_line' => 'Garage, dann Straße.']);
    CarOfTheDay::factory()->create(['day' => '2026-07-16', 'vehicle_id' => $car->id, 'published_at' => null]);
    CarOfTheDay::factory()->create(['day' => '2026-07-17', 'vehicle_id' => giftCar(null, 600)->id]);

    expect(giftExport($owner)['car_of_the_day.json'])->toBe([[
        'day' => '2026-07-15', 'vehicle' => $car->public_id, 'vehicle_name' => giftExport($owner)['car_of_the_day.json'][0]['vehicle_name'], 'story_line' => 'Garage, dann Straße.', 'source' => 'auto',
    ]]);
});

it('exports the Wrapped as presented, without photo links', function () {
    $member = giftMember(['locale' => 'de']);
    Wrapped::factory()->create(['user_id' => $member->id, 'shared_count' => 2]);

    $wrapped = giftExport($member)['wrapped.json'];

    expect($wrapped)->toHaveCount(1)
        ->and($wrapped[0])->toMatchArray(['season_key' => '2027-saison', 'shared_count' => 2, 'viewed_at' => null])
        ->and($wrapped[0]['payload']['cards'])->not->toBeEmpty()
        ->and($wrapped[0]['payload']['member'])->not->toHaveKey('avatar');
});

it('exports the Build Score and its history in vehicles.json', function () {
    $owner = giftMember();
    $car = giftCar($owner, 640);
    DB::table('build_score_history')->insert(['vehicle_id' => $car->id, 'day' => '2026-07-14', 'total' => 600]);

    $row = collect(giftExport($owner)['vehicles.json'])->firstWhere('id', $car->id);

    expect($row['build_score'])->toMatchArray(['total' => 640, 'stage' => 1, 'history' => [['day' => '2026-07-14', 'total' => 600]]])
        ->and($row)->toHaveKey('dex_number');
});

it('never holds a coordinate or an install key in any gift file', function () {
    $owner = giftMember();
    [$car] = dexCar($owner);
    Spot::factory()->create(['vehicle_id' => $car->id, 'spotter_id' => giftMember()->id, 'city_id' => dexCity('Essen')->id, 'counted' => true]);
    Spot::factory()->create(['vehicle_id' => dexCar(giftMember())[0]->id, 'spotter_id' => $owner->id, 'counted' => true]);
    $documents = giftExport($owner);

    foreach (['spots.json', 'spots_of_my_cars.json', 'progress.json', 'invites.json', 'car_of_the_day.json', 'wrapped.json'] as $file) {
        expect(json_encode($documents[$file]))->not->toMatch('/"(lat|lng|latitude|longitude|geohash|coordinates|install_key|install_id)"/');
    }
});
