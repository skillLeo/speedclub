<?php

use App\Enums\Bundesland;
use App\Enums\EventStatus;
use App\Enums\EventType;
use App\Enums\EventVisibility;
use App\Enums\PlateBlurState;
use App\Enums\Rarity;
use App\Enums\RsvpStatus;
use App\Models\BuildUpdate;
use App\Models\EventRsvp;
use App\Models\MaintenanceLog;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\User;

require_once __DIR__.'/WrappedTestHelpers.php';

/**
 * M5.9e (m5.9e contract §3, §8): each card's computation from our tables, cards without data left out, own data only, night/ghost/
 * hidden cities excluded, the percentile's group of ≥ 20, the share card.
 */
beforeEach(function () {
    wrFlags();
    $this->travelTo(wrNow());
    $this->member = User::factory()->create(['bundesland' => Bundesland::NW]);
});

describe('presence', function () {
    it('gives a member without activity no Wrapped at all', function () {
        wrCar($this->member);

        expect(wrBuild($this->member))->toBeNull();
    });

    it('orders the cards as the owner listed them and leaves out those without data', function () {
        $car = wrCar($this->member);
        wrSpot($this->member, wrCar(User::factory()->create()));
        wrMod($car);

        $payload = wrBuild($this->member);

        expect($payload['v'])->toBe(1)
            ->and($payload['season_key'])->toBe(WR_SEASON)
            ->and($payload['window'])->toBe(['from' => '2027-03-01', 'to' => '2027-10-31'])
            ->and(array_column($payload['cards'], 'kind'))->toBe(['intro', 'spots', 'top_mod', 'share'])
            ->and($payload['cards'][0])->toBe(['kind' => 'intro', 'year' => 2027, 'season' => 'saison', 'media_id' => null]);
    });

    it('never writes a card that says 0', function () {
        $car = wrCar($this->member);
        wrMod($car);
        $json = json_encode(wrBuild($this->member));

        foreach (['"count":0', '"sticker_scans":0', '"attended":0'] as $zero) {
            expect($json)->not->toContain($zero);
        }
    });
});

describe('spots', function () {
    it('counts the season\'s counted spots of cars the member may see, never a ghost car', function () {
        $other = User::factory()->create();
        $a = wrCar($other);
        $b = wrCar($other);
        $ghost = wrCar($other, ['ghost_mode' => true]);
        $private = wrCar($other, ['visibility' => 'private']);
        $blockedOwner = User::factory()->create();
        $blocked = wrCar($blockedOwner);
        wrBlock($blockedOwner, $this->member);

        wrSpot($this->member, $a);
        wrSpot($this->member, $a, ['created_at' => wrIn('2027-08-01 12:00:00')->utc()]);
        wrSpot($this->member, $b);
        wrSpot($this->member, $ghost);
        wrSpot($this->member, $private);
        wrSpot($this->member, $blocked);
        wrSpot($this->member, $b, ['counted' => false]);
        wrSpot($this->member, $b, ['deleted_at' => now()]);
        wrSpot($this->member, $b, ['created_at' => wrIn('2027-02-28 23:30:00')->utc()]);
        wrSpot($this->member, $b, ['created_at' => wrIn('2027-11-01 00:00:00')->utc()]);
        // Another member's spot is never the member's.
        wrSpot(User::factory()->create(), $a);

        $card = wrCard($this->member, 'spots');

        expect($card['count'])->toBe(3)->and($card['unique_cars'])->toBe(2);
    });

    it('names at most five cities of day spots, most first, never a night city or a city the owner hides', function () {
        $other = User::factory()->create();
        $car = wrCar($other);
        $hiding = wrCar($other, ['hide_spot_cities' => true]);

        foreach (['Köln' => 3, 'Düsseldorf' => 2, 'Essen' => 1, 'Bonn' => 1, 'Aachen' => 1, 'Duisburg' => 1] as $city => $times) {
            foreach (range(1, $times) as $i) {
                wrSpot($this->member, $car, ['city_id' => wrCity($city)->id]);
            }
        }

        wrSpot($this->member, $car, ['city_id' => wrCity('Nachtstadt')->id, 'is_night' => true]);
        wrSpot($this->member, $car, ['city_id' => wrCity('Nachtstadt')->id, 'is_night' => true]);
        wrSpot($this->member, $car, ['city_id' => wrCity('Nachtstadt')->id, 'is_night' => true]);
        wrSpot($this->member, $car, ['city_id' => wrCity('Nachtstadt')->id, 'is_night' => true]);
        wrSpot($this->member, $hiding, ['city_id' => wrCity('Geheimstadt')->id]);
        wrSpot($this->member, $hiding, ['city_id' => wrCity('Geheimstadt')->id]);
        wrSpot($this->member, $hiding, ['city_id' => wrCity('Geheimstadt')->id]);
        wrSpot($this->member, $hiding, ['city_id' => wrCity('Geheimstadt')->id]);

        $card = wrCard($this->member, 'spots');

        // Ties by name: Aachen, Bonn, Duisburg, Essen have one each.
        expect($card['cities'])->toBe(['Köln', 'Düsseldorf', 'Aachen', 'Bonn', 'Duisburg'])
            ->and(json_encode(wrBuild($this->member)))->not->toContain('Nachtstadt')->not->toContain('Geheimstadt')
            ->not->toContain('lat')->not->toContain('lng');
    });

    it('picks the rarest find by tier, then the lowest Dex number', function () {
        $other = User::factory()->create(['username' => 'owner.secret', 'display_name' => 'Geheimer Besitzer']);
        $street = wrCar($other, ['rarity' => Rarity::Street, 'dex_number' => 1]);
        $rareHigh = wrCar($other, ['rarity' => Rarity::Rare, 'dex_number' => 90]);
        $rareLow = wrCar($other, ['rarity' => Rarity::Rare, 'dex_number' => 12]);
        $tuned = wrCar($other, ['rarity' => Rarity::Tuned, 'dex_number' => 2]);

        foreach ([$street, $rareHigh, $rareLow, $tuned] as $car) {
            wrSpot($this->member, $car);
        }

        $rarest = wrCard($this->member, 'spots')['rarest'];

        expect($rarest['vehicle_id'])->toBe($rareLow->id)
            ->and($rarest['dex_number'])->toBe(12)
            ->and($rarest['rarity'])->toBe('rare')
            ->and($rarest['vehicle_name'])->toBeString()->not->toBe('')
            // Own data only: the car, never its owner.
            ->and(json_encode(wrBuild($this->member)))->not->toContain('owner.secret')->not->toContain('Geheimer Besitzer');
    });
});

describe('scans', function () {
    it('adds the web scans of every code of the member\'s cars and the in-app spots they received', function () {
        $car = wrCar($this->member);
        $code = QrCode::factory()->create(['vehicle_id' => $car->id]);
        $old = QrCode::factory()->revoked()->create(['vehicle_id' => $car->id]);
        QrScanDaily::factory()->create(['qr_code_id' => $code->id, 'day' => '2027-04-02', 'count' => 10]);
        QrScanDaily::factory()->create(['qr_code_id' => $old->id, 'day' => '2027-03-01', 'count' => 5]);
        QrScanDaily::factory()->create(['qr_code_id' => $code->id, 'day' => '2027-02-28', 'count' => 100]);
        QrScanDaily::factory()->create(['qr_code_id' => $code->id, 'day' => '2027-11-01', 'count' => 100]);
        // Another member's sticker never counts.
        QrScanDaily::factory()->create(['day' => '2027-05-01', 'count' => 70]);
        $spotter = User::factory()->create();
        wrSpot($spotter, $car, ['city_id' => wrCity('Köln')->id]);
        wrSpot($spotter, $car, ['city_id' => wrCity('Bonn')->id, 'is_night' => true]);
        wrSpot($spotter, $car, ['city_id' => wrCity('Bonn')->id, 'is_night' => true]);

        expect(wrCard($this->member, 'scans'))->toBe(['kind' => 'scans', 'sticker_scans' => 18, 'profile_or_vehicle_views' => null, 'top_city' => 'Köln']);
    });

    it('names no city while the owner hides the cities, and leaves the card out without scans', function () {
        $car = wrCar($this->member, ['hide_spot_cities' => true]);
        wrMod($car);

        expect(wrCard($this->member, 'scans'))->toBeNull();

        wrSpot(User::factory()->create(), $car, ['city_id' => wrCity('Köln')->id]);

        expect(wrCard($this->member, 'scans'))->toMatchArray(['sticker_scans' => 1, 'top_city' => null]);
    });
});

describe('score', function () {
    it('shows the best car\'s progress over the season with the stages', function () {
        $small = wrCar($this->member);
        $best = wrCar($this->member);
        wrScore($small, 300, ['2027-04-01' => 300]);
        wrScore($best, 642, ['2026-12-01' => 412, '2027-05-01' => 500, '2027-09-30' => 642, '2027-11-01' => 700]);

        expect(wrCard($this->member, 'score'))->toMatchArray(['vehicle_id' => $best->id, 'from' => 412, 'to' => 642, 'stage_from' => 3, 'stage_to' => 4]);
    });

    it('starts at 0 for a car new in the season and leaves out a score that did not rise', function () {
        $new = wrCar($this->member);
        wrScore($new, 220, ['2027-06-01' => 220]);

        expect(wrCard($this->member, 'score'))->toMatchArray(['from' => 0, 'to' => 220, 'stage_from' => 1, 'stage_to' => 2]);

        $other = User::factory()->create();
        $flat = wrCar($other);
        wrMod($flat);
        wrScore($flat, 500, ['2027-01-01' => 500, '2027-06-01' => 480]);

        expect(wrCard($other, 'score'))->toBeNull();
    });
});

describe('top_mod', function () {
    it('takes the season\'s before/after with its two shown photos', function () {
        $car = wrCar($this->member);
        $mod = wrMod($car, 'wheels_tires', ['title' => 'Meister S1 3P', 'brand_text' => 'Work']);
        $update = BuildUpdate::factory()->post()->create(['vehicle_id' => $car->id, 'kind' => 'before_after', 'created_at' => wrIn()->utc()]);
        $update->modifications()->attach($mod->id, ['position' => 0]);
        $before = wrPhoto($update, $this->member);
        $after = wrPhoto($update, $this->member, PlateBlurState::Declined);
        $update->forceFill(['photo_pairs' => [[$before->id, $after->id]]])->save();

        expect(wrCard($this->member, 'top_mod'))->toMatchArray([
            'modification_id' => $mod->id, 'name' => 'Meister S1 3P', 'brand' => 'Work', 'before_media_id' => $before->id, 'after_media_id' => $after->id,
        ]);
    });

    it('never uses a photo whose plate was not checked, and falls back to the best documented mod', function () {
        $car = wrCar($this->member);
        $mod = wrMod($car, 'suspension', ['title' => 'KW V3']);
        $update = BuildUpdate::factory()->post()->create(['vehicle_id' => $car->id, 'kind' => 'before_after', 'created_at' => wrIn()->utc()]);
        $update->modifications()->attach($mod->id, ['position' => 0]);
        $before = wrPhoto($update, $this->member, PlateBlurState::Unchecked);
        $after = wrPhoto($update, $this->member);
        $update->forceFill(['photo_pairs' => [[$before->id, $after->id]]])->save();
        $unchecked = wrPhoto($mod, $this->member, PlateBlurState::Unchecked);
        $plain = wrMod($car, 'interior', ['title' => 'Bride Zeta', 'installed_on' => '2027-09-01']);
        $documented = wrPhoto($plain, $this->member);

        $card = wrCard($this->member, 'top_mod');

        expect($card['modification_id'])->toBe($plain->id)
            ->and($card['before_media_id'])->toBeNull()
            ->and($card['after_media_id'])->toBe($documented->id)
            ->and(json_encode($card))->not->toContain($unchecked->id)->not->toContain($before->id);
    });

    it('reads only the member\'s own mods of the season', function () {
        wrMod(wrCar(User::factory()->create()));
        $car = wrCar($this->member);
        wrMod($car, 'suspension', ['installed_on' => '2026-05-01']);
        wrMod($car, 'suspension', ['status' => 'planned']);

        expect(wrCard($this->member, 'top_mod'))->toBeNull();
    });
});

describe('treffen', function () {
    it('counts attended organised meets of the season and names at most three public ones', function () {
        foreach (['Cars & Coffee Düsseldorf' => '2027-04-04', 'JDM Sonntag am Rhein' => '2027-06-06', 'Saisonabschluss Ruhrpott' => '2027-10-10', 'Frühjahrstreffen' => '2027-03-14'] as $title => $day) {
            wrEvent($this->member, ['title' => $title, 'starts_at' => wrIn("$day 12:00:00")->utc(), 'ends_at' => wrIn("$day 16:00:00")->utc()]);
        }

        wrEvent($this->member, ['title' => 'Nur für Follower', 'visibility' => EventVisibility::Followers]);
        wrEvent($this->member, ['title' => 'Abgesagt', 'status' => EventStatus::Cancelled, 'cancelled_at' => now()]);
        wrEvent($this->member, ['title' => 'Vorjahr', 'starts_at' => wrIn('2026-07-01 12:00:00')->utc(), 'ends_at' => wrIn('2026-07-01 15:00:00')->utc()]);
        $maybe = wrEvent($this->member, ['title' => 'Vielleicht']);
        EventRsvp::query()->where('event_id', $maybe->id)->update(['status' => RsvpStatus::Interested->value]);
        $removed = wrEvent($this->member, ['title' => 'Entfernt']);
        EventRsvp::query()->where('event_id', $removed->id)->update(['removed_at' => now()]);

        expect(wrCard($this->member, 'treffen'))->toBe([
            'kind' => 'treffen',
            'attended' => 5,
            'names' => ['Saisonabschluss Ruhrpott', 'JDM Sonntag am Rhein', 'Cars & Coffee Düsseldorf'],
        ]);
    });

    it('counts no meet that has not taken place yet', function () {
        $this->travelTo(wrIn('2027-07-04 19:00:00'));
        wrEvent($this->member);

        expect(wrCard($this->member, 'treffen'))->toBeNull();
    });
});

describe('build_spirit', function () {
    it('decides each rule from the mod mix', function (array $mods, ?int $year, string $key) {
        $car = wrCar($this->member, $year === null ? [] : ['model_year' => $year]);

        foreach ($mods as $category => $count) {
            foreach (range(1, $count) as $i) {
                wrMod($car, $category);
            }
        }

        expect(wrCard($this->member, 'build_spirit')['key'] ?? null)->toBe($key);
    })->with([
        'stance' => [['suspension' => 2, 'wheels_tires' => 2, 'interior' => 1], null, 'shakotan_artist'],
        'engine without exterior' => [['engine_performance' => 2, 'exhaust' => 1, 'interior' => 1], null, 'engine_purist'],
        'details' => [['interior' => 2, 'electronics' => 2, 'brakes' => 1], null, 'detail_perfectionist'],
        'classic with upgrades' => [['brakes' => 2, 'suspension' => 1], 1991, 'restomod_romantic'],
    ]);

    it('gives no Engine Purist to a build with an exterior mod, and none below the share', function () {
        $car = wrCar($this->member);
        wrMod($car, 'engine_performance');
        wrMod($car, 'exhaust');
        wrMod($car, 'aero_body');

        expect(wrCard($this->member, 'build_spirit'))->toBeNull();
    });

    it('resolves a tie by the configured order', function () {
        $car = wrCar($this->member);
        wrMod($car, 'suspension');
        wrMod($car, 'suspension');
        wrMod($car, 'interior');
        wrMod($car, 'electronics');

        // 50 % stance, 50 % details: shakotan_artist comes first in wrapped.spirit.order.
        expect(wrCard($this->member, 'build_spirit'))->toMatchArray(['key' => 'shakotan_artist', 'params' => ['share' => 50]]);

        config(['speedclub.wrapped.spirit.order' => ['detail_perfectionist', 'shakotan_artist']]);

        expect(wrCard($this->member, 'build_spirit')['key'])->toBe('detail_perfectionist');
    });

    it('makes a Track-Day Tactician only of an attended organised track day, never of parts', function () {
        $car = wrCar($this->member);
        wrMod($car, 'brakes', ['title' => 'Trackday Bremsbeläge']);
        wrMod($car, 'other', ['title' => 'Rennsitz Track']);
        wrEvent($this->member, ['type' => EventType::Meet, 'title' => 'Trackday-Treffen am Parkplatz']);

        expect(wrCard($this->member, 'build_spirit')['key'] ?? null)->not->toBe('track_day_tactician');

        $cancelled = wrEvent($this->member, ['type' => EventType::TrackDay, 'status' => EventStatus::Cancelled, 'cancelled_at' => now()]);
        expect(wrCard($this->member, 'build_spirit')['key'] ?? null)->not->toBe('track_day_tactician');

        wrEvent($this->member, ['type' => EventType::TrackDay, 'title' => 'Trackday Nürburgring']);

        expect(wrCard($this->member, 'build_spirit'))->toMatchArray(['key' => 'track_day_tactician', 'params' => ['count' => 1], 'basis' => 'season']);
    });

    it('makes a Daily Hero of regular maintenance with few mods', function () {
        $car = wrCar($this->member);

        foreach (['2027-03-10', '2027-05-10', '2027-08-10'] as $day) {
            MaintenanceLog::factory()->create(['vehicle_id' => $car->id, 'done_at' => $day]);
        }

        expect(wrCard($this->member, 'build_spirit'))->toMatchArray(['key' => 'daily_hero', 'params' => ['logs' => 3, 'months' => 3], 'basis' => 'season'])
            ->and(wrKinds($this->member))->toBe(['intro', 'build_spirit', 'share']);
    });

    it('reads the whole build when the season has few mods, which alone is no season activity', function () {
        $car = wrCar($this->member);
        wrMod($car, 'suspension', ['installed_on' => '2025-05-01']);
        wrMod($car, 'wheels_tires', ['installed_on' => '2025-06-01']);
        wrMod($car, 'wheels_tires', ['installed_on' => '2025-07-01']);

        expect(wrBuild($this->member))->toBeNull();

        wrSpot(User::factory()->create(), $car);

        expect(wrCard($this->member, 'build_spirit'))->toMatchArray(['key' => 'shakotan_artist', 'basis' => 'build']);
    });
});

describe('percentile', function () {
    beforeEach(function () {
        $this->ownCar = wrCar($this->member);
        wrMod($this->ownCar);
        wrScore($this->ownCar, 700);
    });

    function wrPeers(int $count, int $total, Bundesland $bundesland = Bundesland::NW, array $owner = []): void
    {
        foreach (range(1, $count) as $i) {
            wrScore(wrCar(User::factory()->create(['bundesland' => $bundesland, ...$owner])), $total);
        }
    }

    it('needs at least 20 members in the Bundesland', function () {
        wrPeers(18, 300);
        wrPeers(10, 300, Bundesland::BY);
        wrPeers(5, 300, Bundesland::NW, ['is_sample' => true]);

        expect(wrCard($this->member, 'percentile'))->toBeNull();

        wrPeers(1, 900);

        expect(wrCard($this->member, 'percentile'))->toBe(['kind' => 'percentile', 'bundesland' => 'NW', 'top' => 10, 'members' => 20, 'metric' => 'build_score']);
    });

    it('counts a member once, by their best car', function () {
        wrPeers(19, 300);
        $many = User::factory()->create(['bundesland' => Bundesland::NW]);
        wrScore(wrCar($many), 800);
        wrScore(wrCar($many), 100);

        expect(wrCard($this->member, 'percentile'))->toMatchArray(['members' => 21, 'top' => 10]);
    });

    it('leaves out a place below the top half, and a car that may not be ranked', function () {
        wrPeers(19, 900);

        expect(wrCard($this->member, 'percentile'))->toBeNull();

        $this->ownCar->forceFill(['visibility' => 'private'])->save();
        wrPeers(40, 100);

        expect(wrCard($this->member, 'percentile'))->toBeNull();
    });
});

describe('share', function () {
    it('closes the story with the score card\'s car, its Dex number, score and a shown photo', function () {
        $main = wrCar($this->member, ['is_main' => true, 'dex_number' => 7]);
        $progress = wrCar($this->member, ['dex_number' => 87]);
        wrScore($main, 800);
        wrScore($progress, 642, ['2027-06-01' => 642]);
        $cover = wrPhoto($progress, $this->member);
        $progress->forceFill(['cover_media_id' => $cover->id])->save();

        expect(wrCard($this->member, 'share'))->toMatchArray([
            'vehicle_id' => $progress->id, 'dex_number' => 87, 'score' => 642, 'media_id' => $cover->id,
        ]);
    });

    it('has no share card without a published car', function () {
        wrSpot($this->member, wrCar(User::factory()->create()));

        expect(wrKinds($this->member))->toBe(['intro', 'spots']);
    });
});
