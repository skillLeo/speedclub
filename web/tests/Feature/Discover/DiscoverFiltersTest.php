<?php

use App\Enums\ModStatus;
use App\Enums\UserStatus;
use App\Models\Follow;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Search\VehicleSearchProjector;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/DiscoverM23Helpers.php';

/**
 * M2.3 DISC-02 filters and sorts on search/vehicles and the overview (m2.3 contract §1, 02_PRODUCT_SPEC §3.7).
 */
beforeEach(function () {
    seedModSchema();
    $this->withHeader('Accept-Language', 'de');
});

describe('filters', function () {
    it('applies each filter on its own', function (string $query, string $expected) {
        $builds = [
            'm4' => m23Build('BMW', 'M4', 'G82', ['year' => 2022, 'power' => 510, 'drivetrain' => 'rear', 'gearbox' => 'automatic'], [
                ['wheels_tires', ['diameter' => 20, 'diameter_rear' => 21], 'HRE'],
                ['suspension', ['type' => 'coilover'], 'KW'],
            ]),
            'golf' => m23Build('Volkswagen', 'Golf GTI', 'VII (5G)', ['year' => 2015, 'power' => 230, 'drivetrain' => 'front', 'fuel' => 'petrol', 'gearbox' => 'dual_clutch'], [
                ['wheels_tires', ['diameter' => 18], 'BBS'],
                ['suspension', ['type' => 'lowering_springs'], 'Eibach'],
                ['exhaust', [], 'Akrapovič'],
            ]),
            'rs6' => m23Build('Audi', 'RS6', 'C8', ['year' => 2021, 'power' => 600, 'drivetrain' => 'all', 'fuel' => 'hybrid', 'gearbox' => 'automatic'], [
                ['interior', ['part' => 'seats'], 'Recaro'],
            ]),
        ];

        expect(m23Search($query))->toBe([$builds[$expected]->id]);
    })->with([
        'make' => ['make=audi', 'rs6'],
        'model' => ['make=bmw&model=m4', 'm4'],
        'generation' => ['make=volkswagen&model=golf-gti&generation=vii-5g', 'golf'],
        'year range' => ['year_min=2014&year_max=2016', 'golf'],
        'power from' => ['power_min=550', 'rs6'],
        'power to' => ['power_max=300', 'golf'],
        'drivetrain' => ['drivetrain[]=front', 'golf'],
        'gearbox' => ['gearbox[]=dual_clutch', 'golf'],
        'fuel' => ['fuel[]=hybrid', 'rs6'],
        'wheel diameter, front' => ['wheel_diameter[]=18', 'golf'],
        'wheel diameter, rear of a staggered set (ADR-112)' => ['wheel_diameter[]=21', 'm4'],
        'wheel brand' => ['wheel_brand[]=hre', 'm4'],
        'suspension type' => ['suspension_type[]=lowering_springs', 'golf'],
        'suspension brand' => ['suspension_brand[]=kw', 'm4'],
        'exhaust brand' => ['exhaust_brand[]=akrapovic', 'golf'],
        'mod category' => ['mod_category[]=interior', 'rs6'],
        'model by its page key, without make' => ['model=bmw--m4', 'm4'],
    ]);

    it('applies both values of one list: they are alternatives', function (string $key, string $first, string $second) {
        $a = m23Build('BMW', 'M4', 'G82', ['drivetrain' => 'rear', 'gearbox' => 'manual', 'fuel' => 'petrol'], [
            ['wheels_tires', ['diameter' => 19], 'BBS'], ['suspension', ['type' => 'coilover'], 'KW'], ['exhaust', [], 'Akrapovič'], ['aero_body', ['part' => 'splitter']],
        ]);
        $b = m23Build('Audi', 'RS3', '8Y', ['drivetrain' => 'all', 'gearbox' => 'dual_clutch', 'fuel' => 'diesel'], [
            ['wheels_tires', ['diameter' => 20], 'HRE'], ['suspension', ['type' => 'air'], 'Bilstein'], ['exhaust', [], 'Milltek'], ['brakes', [], 'Brembo'],
        ]);
        m23Build('Mazda', 'MX-5', 'ND', ['drivetrain' => 'front', 'gearbox' => 'automatic', 'fuel' => 'electric'], [
            ['wheels_tires', ['diameter' => 15], 'Enkei'], ['suspension', ['type' => 'stock'], 'Eibach'], ['exhaust', [], 'Remus'], ['interior', [], 'Recaro'],
        ]);

        $ids = m23Search("{$key}[]=$first&{$key}[]=$second");

        expect($ids)->toHaveCount(2)->toContain($a->id, $b->id)
            ->and(m23Search("{$key}[]=$first"))->toBe([$a->id]);
    })->with([
        ['drivetrain', 'rear', 'all'],
        ['gearbox', 'manual', 'dual_clutch'],
        ['fuel', 'petrol', 'diesel'],
        ['wheel_diameter', '19', '20'],
        ['wheel_brand', 'bbs', 'hre'],
        ['suspension_type', 'coilover', 'air'],
        ['suspension_brand', 'kw', 'bilstein'],
        ['exhaust_brand', 'akrapovic', 'milltek'],
        ['mod_category', 'aero_body', 'brakes'],
    ]);

    it('applies different filters together', function () {
        $hit = m23Build('BMW', 'M4', 'G82', ['power' => 510], [['wheels_tires', ['diameter' => 19], 'BBS']]);
        m23Build('BMW', 'M2', 'G87', ['power' => 460], [['wheels_tires', ['diameter' => 19], 'BBS']]);
        m23Build('BMW', 'M4', 'F82', ['power' => 431], [['wheels_tires', ['diameter' => 18], 'BBS']]);

        expect(m23Search('make=bmw&wheel_diameter[]=19&power_min=500'))->toBe([$hit->id]);
    });

    it('reads every installed part, not just the first of a category, and never a planned or removed one', function () {
        $two = m23Build('Nissan', 'Silvia', 'S15', [], [
            ['wheels_tires', ['diameter' => 17], 'Rays'],
            ['wheels_tires', ['diameter' => 18], 'Work Wheels'],
            ['suspension', ['type' => 'lowering_springs'], 'Eibach'],
            ['suspension', ['type' => 'sport_dampers'], 'Bilstein'],
        ]);
        m23Build('Nissan', '350Z', 'Z33', [], [
            ['wheels_tires', ['diameter' => 19], 'Rays', ModStatus::Planned],
            ['suspension', ['type' => 'coilover'], 'KW', ModStatus::Removed],
        ]);

        expect(m23Search('wheel_brand[]=work-wheels'))->toBe([$two->id])
            ->and(m23Search('wheel_diameter[]=18'))->toBe([$two->id])
            ->and(m23Search('suspension_brand[]=bilstein&suspension_type[]=sport_dampers'))->toBe([$two->id])
            ->and(m23Search('wheel_diameter[]=19'))->toBe([])
            ->and(m23Search('suspension_brand[]=kw'))->toBe([]);
    });

    it('drops the facet rows of a part once it is removed, after the rebuild', function () {
        $vehicle = m23Build('Nissan', 'Silvia', 'S15', [], [['wheels_tires', ['diameter' => 17], 'Rays']]);
        expect(m23Search('wheel_brand[]=rays'))->toBe([$vehicle->id]);

        $vehicle->modifications()->update(['status' => ModStatus::Removed->value]);
        app(VehicleSearchProjector::class)->rebuild($vehicle->id);

        expect(m23Search('wheel_brand[]=rays'))->toBe([]);
    });

    it('counts a merged brand as the brand it was merged into', function () {
        $target = m23Brand('Volk Racing');
        $old = m23Brand('Rays Volk');
        $old->update(['merged_into_id' => $target->id]);
        $vehicle = m23Build('Nissan', 'Silvia', 'S15', [], [['wheels_tires', ['diameter' => 17], 'Volk Racing']]);

        expect(m23Search('wheel_brand[]=rays-volk'))->toBe([$vehicle->id])
            ->and(m23Search('wheel_brand[]=volk-racing'))->toBe([$vehicle->id]);
    });

    it('combines text and filters on the overview, which finds members by text only', function () {
        $m4 = m23Build('BMW', 'M4', 'G82', [], [['wheels_tires', ['diameter' => 19], 'BBS']]);
        m23Build('BMW', 'M4', 'G82', [], [['wheels_tires', ['diameter' => 20], 'BBS']]);

        $this->getJson('/api/v1/search?q=m4&wheel_diameter[]=19')->assertOk()
            ->assertJsonPath('data.vehicles.count', 1)
            ->assertJsonPath('data.vehicles.items.0.id', $m4->id);

        $this->getJson('/api/v1/search?wheel_diameter[]=19')->assertOk()
            ->assertJsonPath('data.query', '')
            ->assertJsonPath('data.vehicles.count', 1)
            ->assertJsonPath('data.members.count', 0);
    });
});

describe('text and sorts', function () {
    it('needs no text once a filter or a sort is set, and still needs something', function () {
        $older = m23Build('BMW', 'M4', 'G82', ['published_at' => '2026-01-01 10:00:00']);
        $newer = m23Build('Audi', 'RS3', '8Y', ['published_at' => '2026-02-01 10:00:00']);

        expect(m23Search('sort=newest'))->toBe([$newer->id, $older->id])
            ->and(m23Search('make=bmw'))->toBe([$older->id]);

        $this->getJson('/api/v1/search/vehicles')->assertUnprocessable()
            ->assertJsonPath('errors.q.0', 'Gib einen Suchbegriff ein, zum Beispiel eine Marke, ein Modell oder einen Benutzernamen.');
        $this->getJson('/api/v1/search')->assertUnprocessable()->assertJsonValidationErrors('q');
        $this->getJson('/api/v1/search/users?make=bmw')->assertUnprocessable()->assertJsonValidationErrors('q');
    });

    it('sorts by newest, last change and power, builds without power last', function () {
        $a = m23Build('BMW', 'M4', 'G82', ['power' => 510, 'published_at' => '2026-01-01 10:00:00', 'updated_at' => '2026-03-01 10:00:00']);
        $b = m23Build('BMW', 'M2', 'G87', ['power' => null, 'published_at' => '2026-02-01 10:00:00', 'updated_at' => '2026-02-15 10:00:00']);
        $c = m23Build('BMW', 'M3', 'G80', ['power' => 530, 'published_at' => '2026-01-15 10:00:00', 'updated_at' => '2026-01-20 10:00:00']);

        expect(m23Search('make=bmw&sort=newest', 1))->toBe([$b->id, $c->id, $a->id])
            ->and(m23Search('make=bmw&sort=updated', 1))->toBe([$a->id, $b->id, $c->id])
            ->and(m23Search('make=bmw&sort=power', 1))->toBe([$c->id, $a->id, $b->id])
            ->and(m23Search('make=bmw', 1))->toBe([$b->id, $c->id, $a->id])
            // Relevance without a text is newest.
            ->and(m23Search('make=bmw&sort=relevance', 1))->toBe([$b->id, $c->id, $a->id]);
    });

    it('keeps relevance first with a text, and sorts a text by power when asked', function () {
        $exact = m23Build('BMW', 'M4', 'G82', ['power' => 400]);
        $mod = m23Build('Volkswagen', 'Golf', 'VII (5G)', ['power' => 600], [['interior', ['part' => 'steering_wheel', 'model' => 'M4 Lenkrad'], 'BMW']]);

        expect(m23Search('q=m4'))->toBe([$exact->id, $mod->id])
            ->and(m23Search('q=m4&sort=power'))->toBe([$mod->id, $exact->id]);
    });
});

describe('cursors', function () {
    it('pages a filtered, sorted list without repeats or gaps', function (string $sort) {
        $ids = [];

        foreach (range(1, 7) as $i) {
            $ids[] = m23Build('BMW', 'M4', 'G82', ['power' => 300 + $i * 10, 'published_at' => "2026-01-0$i 10:00:00"])->id;
        }

        m23Build('Audi', 'RS3', '8Y');
        $paged = m23Search("make=bmw&sort=$sort", 2);

        expect($paged)->toHaveCount(7)->and(array_unique($paged))->toHaveCount(7)
            ->and(m23Search("make=bmw&sort=$sort", 50))->toBe($paged);
    })->with(['newest', 'updated', 'power']);

    it('refuses a cursor of another sort, filter set or text', function (string $other) {
        foreach (range(1, 3) as $i) {
            m23Build('BMW', 'M4', 'G82', ['power' => 400 + $i], [['wheels_tires', ['diameter' => 19], 'BBS']]);
        }

        $cursor = $this->getJson('/api/v1/search/vehicles?make=bmw&sort=newest&per_page=1')->assertOk()->json('meta.next_cursor');
        expect($cursor)->toBeString();

        $this->getJson('/api/v1/search/vehicles?make=bmw&sort=newest&per_page=1&cursor='.$cursor)->assertOk();
        $this->getJson("/api/v1/search/vehicles?$other&per_page=1&cursor=$cursor")->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonPath('errors.cursor.0', 'Diese Seite der Liste gibt es nicht. Lade die Liste bitte neu.');
    })->with([
        'another sort, other columns' => ['make=bmw&sort=power'],
        'another sort, same columns' => ['make=bmw&sort=updated'],
        'another filter' => ['make=bmw&sort=newest&wheel_diameter[]=19'],
        'no filter' => ['sort=newest'],
        'a text' => ['q=m4&make=bmw&sort=newest'],
    ]);

    it('continues the overview on search/vehicles with the same text and filters', function () {
        foreach (range(1, 12) as $i) {
            m23Build('BMW', 'M4', 'G82', [], [['wheels_tires', ['diameter' => 19], 'BBS']]);
        }

        $overview = $this->getJson('/api/v1/search?q=bmw&wheel_diameter[]=19')->assertOk();
        $rest = $this->getJson('/api/v1/search/vehicles?q=bmw&wheel_diameter[]=19&cursor='.$overview->json('data.vehicles.next_cursor'))->assertOk();

        expect(count($overview->json('data.vehicles.items')) + count($rest->json('data')))->toBe(12);
        $this->getJson('/api/v1/search/vehicles?q=bmw&cursor='.$overview->json('data.vehicles.next_cursor'))->assertUnprocessable();
    });
});

describe('validation', function () {
    it('answers unknown values with 422 on their field, in German', function (string $query, string $field, string $message) {
        m23Catalog('BMW', 'M4', 'G82');
        m23Catalog('Ford', 'GT');
        m23Catalog('Lamborghini', 'GT');

        $errors = $this->getJson('/api/v1/search/vehicles?'.$query)->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->json('errors');

        expect($errors[$field][0] ?? null)->toBe($message);
    })->with([
        'make' => ['make=trabbi', 'make', 'Diese Marke gibt es im Katalog nicht. Wähle eine Marke aus der Liste.'],
        'model of the make' => ['make=bmw&model=golf', 'model', 'Dieses Modell gibt es bei dieser Marke nicht. Wähle ein Modell aus der Liste.'],
        'model of several makes' => ['model=gt', 'model', 'Diesen Modellnamen gibt es bei mehreren Marken. Wähle zuerst die Marke.'],
        'model page key' => ['model=bmw--golf', 'model', 'Dieses Modell gibt es bei dieser Marke nicht. Wähle ein Modell aus der Liste.'],
        'generation' => ['make=bmw&model=m4&generation=e30', 'generation', 'Diese Generation gibt es bei diesem Modell nicht. Wähle eine Generation aus der Liste.'],
        'generation without model' => ['make=bmw&generation=g82', 'generation', 'Eine Generation lässt sich nur mit Modell filtern. Wähle zuerst das Modell.'],
        'wheel brand' => ['wheel_brand[]=bbs&wheel_brand[]=gibtsnicht', 'wheel_brand', 'Diese Marke gibt es im Teilekatalog nicht. Wähle eine Marke aus der Liste.'],
        'suspension brand' => ['suspension_brand[]=gibtsnicht', 'suspension_brand', 'Diese Marke gibt es im Teilekatalog nicht. Wähle eine Marke aus der Liste.'],
        'exhaust brand' => ['exhaust_brand[]=gibtsnicht', 'exhaust_brand', 'Diese Marke gibt es im Teilekatalog nicht. Wähle eine Marke aus der Liste.'],
        'suspension type' => ['suspension_type[]=hydropneumatik', 'suspension_type', 'Diesen Wert gibt es für diesen Filter nicht. Wähle einen Wert aus der Liste.'],
        'mod category' => ['mod_category[]=tuning', 'mod_category', 'Diesen Wert gibt es für diesen Filter nicht. Wähle einen Wert aus der Liste.'],
        'drivetrain' => ['drivetrain[]=hinten', 'drivetrain.0', 'Diesen Wert gibt es für diesen Filter nicht. Wähle einen Wert aus der Liste.'],
        'a plain value where a list belongs' => ['drivetrain=rear', 'drivetrain', 'Dieser Filter braucht eine Liste, zum Beispiel drivetrain[]=rear.'],
        'wheel diameter off the half inch' => ['wheel_diameter[]=19.3', 'wheel_diameter.0', 'Diesen Felgendurchmesser gibt es nicht. Wähle einen Wert von 13″ bis 24″ in Schritten von 0,5″.'],
        'wheel diameter too large' => ['wheel_diameter[]=26', 'wheel_diameter.0', 'Diesen Felgendurchmesser gibt es nicht. Wähle einen Wert von 13″ bis 24″ in Schritten von 0,5″.'],
        'year range reversed' => ['year_min=2010&year_max=2000', 'year_max', 'Der Höchstwert liegt unter dem Mindestwert. Passe einen der beiden Werte an.'],
        'power range reversed' => ['power_min=500&power_max=400', 'power_max', 'Der Höchstwert liegt unter dem Mindestwert. Passe einen der beiden Werte an.'],
    ]);

    it('answers in English when asked', function () {
        $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/search/vehicles?make=trabbi')->assertUnprocessable()
            ->assertJsonPath('errors.make.0', 'This make is not in the catalogue. Choose a make from the list.');
    });

    it('refuses power and sorts outside their bounds', function (string $query, string $field) {
        $this->getJson('/api/v1/search/vehicles?'.$query)->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        ['power_min=40', 'power_min'],
        ['power_max=1600', 'power_max'],
        ['sort=cheapest', 'sort'],
        ['year_min=1800', 'year_min'],
    ]);

    it('accepts a model slug only one make has without the make', function () {
        $m4 = m23Build('BMW', 'M4', 'G82');

        expect(m23Search('model=m4'))->toBe([$m4->id]);
    });
});

describe('visibility of filtered lists', function () {
    it('never lists a build that is not public, nor one of an owner nobody may see', function () {
        $visible = m23Build('BMW', 'M4', 'G82');
        m23Build('BMW', 'M4', 'G82', ['visibility' => 'private']);
        m23Build('BMW', 'M4', 'G82', ['visibility' => 'unlisted']);
        $suspended = m23Build('BMW', 'M4', 'G82');
        User::query()->whereKey($suspended->owner_id)->update(['status' => UserStatus::Suspended->value]);
        Vehicle::factory()->create(m23Catalog('BMW', 'M4', 'G82'));

        expect(m23Search('make=bmw'))->toBe([$visible->id])
            ->and(m23Search('sort=newest'))->toBe([$visible->id]);
        $this->getJson('/api/v1/search?make=bmw')->assertJsonPath('data.vehicles.count', 1);
    });

    it('hides builds across a block in either direction, guests see them', function () {
        $viewer = User::factory()->create();
        $blocked = m23Build('BMW', 'M4', 'G82');
        $blocker = m23Build('BMW', 'M4', 'G82');
        $free = m23Build('BMW', 'M4', 'G82');
        m23Block($viewer, $blocked->owner);
        m23Block($blocker->owner, $viewer);

        expect(m23Search('make=bmw'))->toHaveCount(3);

        Sanctum::actingAs($viewer);

        expect(m23Search('make=bmw'))->toBe([$free->id]);
    });

    it('shows the owner their own public build like everybody else, and never their private one', function () {
        $owner = User::factory()->create();
        $public = m23Build('BMW', 'M4', 'G82', ['owner' => $owner]);
        m23Build('BMW', 'M4', 'G82', ['owner' => $owner, 'visibility' => 'private']);
        Sanctum::actingAs($owner);

        expect(m23Search('make=bmw'))->toBe([$public->id]);
    });
});

describe('member search by city', function () {
    it('finds the start of a word of the city, discoverable members only', function () {
        $stuttgart = User::factory()->create(['username' => 'jonas.k', 'display_name' => 'Jonas Keller', 'city' => 'Stuttgart']);
        User::factory()->create(['username' => 'hidden.one', 'display_name' => 'Anna Berg', 'city' => 'Stuttgart', 'discoverable' => false]);
        $twoWords = User::factory()->create(['username' => 'lea.w', 'display_name' => 'Lea Wolf', 'city' => 'Bad Homburg']);
        User::factory()->create(['username' => 'tim.s', 'display_name' => 'Tim Sauer', 'city' => 'Kassel']);

        $this->getJson('/api/v1/search/users?q=stutt')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.username', $stuttgart->username);
        $this->getJson('/api/v1/search/users?q=homb')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.username', $twoWords->username);
        $this->getJson('/api/v1/search/users?q=gart')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/search?q=stutt')->assertOk()->assertJsonPath('data.members.count', 1);
    });

    it('ranks a name above a city', function () {
        User::factory()->create(['username' => 'kasper', 'display_name' => 'Kasper Lund', 'city' => 'Bremen']);
        User::factory()->create(['username' => 'tim.s', 'display_name' => 'Tim Sauer', 'city' => 'Kassel']);

        expect(array_column($this->getJson('/api/v1/search/users?q=kas')->assertOk()->json('data'), 'username'))->toBe(['kasper', 'tim.s']);
    });

    it('leaves the city out of the follower lists of PROF-04', function () {
        $member = User::factory()->create(['username' => 'jonas.k', 'city' => 'Stuttgart']);
        $listed = User::factory()->create(['username' => 'lena.x', 'display_name' => 'Lena X', 'city' => 'Stuttgart']);
        Follow::factory()->create(['follower_id' => $listed->id, 'followee_id' => $member->id]);

        $this->getJson('/api/v1/public/users/jonas.k/followers?q=stutt')->assertOk()->assertJsonCount(0, 'data');
    });
});
