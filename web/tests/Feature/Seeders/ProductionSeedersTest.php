<?php

use App\Enums\ConfigVersionStatus;
use App\Enums\LegalDocumentKey;
use App\Enums\ModFieldType;
use App\Models\Brand;
use App\Models\ConfigVersion;
use App\Models\FeatureFlag;
use App\Models\Generation;
use App\Models\LegalDocument;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\Permission;
use App\Models\Role;
use App\Models\Staff;
use App\Models\VehicleModel;
use App\Services\AppConfig\AppConfig;
use Database\Seeders\BrandSeeder;
use Database\Seeders\CatalogSeeder;
use Database\Seeders\ConfigSeeder;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DemoSeeder;
use Database\Seeders\FeatureFlagSeeder;
use Database\Seeders\LegalDocumentSeeder;
use Database\Seeders\ModCategorySeeder;
use Database\Seeders\StaffSeeder;

it('seeds a catalogue of at least 40 makes with sane generations', function () {
    $this->seed(CatalogSeeder::class);

    expect(Make::query()->count())->toBeGreaterThanOrEqual(40)
        ->and(Make::query()->where('is_popular', true)->count())->toBeGreaterThan(0);

    $thisYear = (int) now()->year;

    foreach (Generation::query()->get() as $generation) {
        $label = "generation {$generation->id} {$generation->name}";

        expect($generation->year_from)->not->toBeNull($label)->toBeLessThanOrEqual($thisYear, $label);

        if ($generation->year_to !== null) {
            expect($generation->year_to)->toBeGreaterThanOrEqual($generation->year_from, $label)
                ->toBeLessThanOrEqual($thisYear, $label);
        }
    }
});

it('has the generations enthusiasts check first', function (string $make, string $model, array $expected) {
    $this->seed(CatalogSeeder::class);

    $id = Make::query()->where('name', $make)->firstOrFail()->models()->where('name', $model)->firstOrFail()->id;

    foreach ($expected as $name => [$from, $to]) {
        $generation = Generation::query()->where('model_id', $id)->where('name', $name)->firstOrFail();

        expect([$generation->year_from, $generation->year_to])->toBe([$from, $to]);
    }
})->with([
    'M4' => ['BMW', 'M4', ['F82' => [2014, 2020], 'G82' => [2021, null]]],
    'M3' => ['BMW', 'M3', ['E30' => [1986, 1991], 'E36' => [1992, 1999], 'E46' => [2000, 2006], 'E90/E92/E93' => [2007, 2013], 'F80' => [2014, 2018], 'G80' => [2021, null]]],
    'Skyline GT-R' => ['Nissan', 'Skyline GT-R', ['R32' => [1989, 1994], 'R33' => [1995, 1998], 'R34' => [1999, 2002]]],
    'Supra' => ['Toyota', 'Supra', ['A80' => [1993, 2002], 'A90' => [2019, 2026]]],
    '911' => ['Porsche', '911', ['G-Modell' => [1974, 1989], '930' => [1975, 1989], '964' => [1989, 1994], '993' => [1994, 1998], '992' => [2019, null]]],
    'Transporter' => ['Volkswagen', 'Transporter', ['T6.1' => [2019, 2024]]],
    'Swift Sport' => ['Suzuki', 'Swift Sport', ['ZC33S' => [2017, 2025]]],
    'Ateca' => ['Cupra', 'Ateca', ['KH' => [2018, 2026]]],
    'Roma' => ['Ferrari', 'Roma', ['F169' => [2020, 2026]]],
    '8er' => ['BMW', '8er', ['G14/G15/G16' => [2018, 2026]]],
    'LC' => ['Lexus', 'LC', ['Z100' => [2017, 2026]]],
    'Ceed GT' => ['Kia', 'Ceed GT', ['CD' => [2018, 2026]]],
    'RX-7' => ['Mazda', 'RX-7', ['SA22C/FB' => [1978, 1985], 'FC' => [1985, 1991], 'FD' => [1992, 2002]]],
    'Golf' => ['Volkswagen', 'Golf', ['IV (1J)' => [1997, 2006], 'VI (5K)' => [2008, 2013]]],
    'Golf GTI' => ['Volkswagen', 'Golf GTI', ['VI (5K)' => [2009, 2013]]],
    'RS6' => ['Audi', 'RS6', ['C8' => [2019, 2025]]],
    'RS7' => ['Audi', 'RS7', ['C8' => [2019, 2025]]],
    'Taycan' => ['Porsche', 'Taycan', ['9J1' => [2019, null]]],
    'e-tron GT' => ['Audi', 'e-tron GT', ['FW' => [2021, null]]],
    'S2000' => ['Honda', 'S2000', ['AP1' => [1999, 2009], 'AP2' => [2004, 2009]]],
    'Cappuccino' => ['Suzuki', 'Cappuccino', ['EA11R' => [1991, 1995], 'EA21R' => [1995, 1998]]],
    'Celica' => ['Toyota', 'Celica', ['T160' => [1985, 1989], 'T180' => [1989, 1993], 'T200' => [1993, 1999], 'T230' => [1999, 2006]]],
    'Clio' => ['Renault', 'Clio', ['V' => [2019, 2025], 'VI' => [2025, null]]],
    'CLA' => ['Mercedes-Benz', 'CLA', ['C178' => [2025, null]]],
    'A5' => ['Audi', 'A5', ['B10' => [2024, null]]],
    'Cooper' => ['MINI', 'Cooper', ['F66' => [2024, null]]],
    'Civic Type R' => ['Honda', 'Civic Type R', ['EK9' => [1997, 2000], 'FK8' => [2017, 2021], 'FL5' => [2022, null]]],
]);

it('covers Golf I to VIII and all brief makes', function () {
    $this->seed(CatalogSeeder::class);

    $golf = VehicleModel::query()->where('name', 'Golf')->firstOrFail();

    expect(Generation::query()->where('model_id', $golf->id)->count())->toBe(8);

    foreach (['BMW', 'Mercedes-Benz', 'Audi', 'Volkswagen', 'Porsche', 'Opel', 'Ford', 'SEAT', 'Cupra', 'Škoda', 'MINI', 'Smart', 'Renault', 'Peugeot', 'Citroën', 'Alpine', 'Fiat', 'Abarth', 'Alfa Romeo', 'Lancia', 'Ferrari', 'Lamborghini', 'Maserati', 'Volvo', 'Saab', 'Polestar', 'Tesla', 'Jaguar', 'Land Rover', 'Lotus', 'Aston Martin', 'Bentley', 'McLaren', 'Nissan', 'Toyota', 'Lexus', 'Honda', 'Mazda', 'Subaru', 'Mitsubishi', 'Suzuki', 'Hyundai', 'Kia', 'Infiniti', 'Dodge', 'Chevrolet', 'Dacia'] as $make) {
        expect(Make::query()->where('name', $make)->exists())->toBeTrue($make);
    }
});

it('seeds the ten categories with the field counts of the spec', function () {
    $this->seed(ModCategorySeeder::class);

    $expected = [
        'wheels_tires' => ['wheel', 17],
        'suspension' => ['coilover', 6],
        'exhaust' => ['exhaust', 5],
        'engine_performance' => ['turbo', 10],
        'brakes' => ['brake-disc', 7],
        'aero_body' => ['wing', 4],
        'interior' => ['seat', 3],
        'electronics' => ['light', 3],
        'drivetrain' => ['gearbox', 3],
        'other' => ['wrench', 1],
    ];

    expect(ModCategory::query()->count())->toBe(10);

    foreach ($expected as $key => [$icon, $fields]) {
        $category = ModCategory::query()->where('key', $key)->firstOrFail();

        expect($category->icon)->toBe($icon)
            ->and($category->fields()->count())->toBe($fields, $key)
            ->and($category->getTranslation('name', 'de'))->not->toBe('')
            ->and($category->getTranslation('name', 'en'))->not->toBe('');
    }
});

it('matches the field rules and option lists of the spec exactly', function () {
    $this->seed(ModCategorySeeder::class);

    $field = fn (string $category, string $key) => ModCategory::query()->where('key', $category)->firstOrFail()
        ->fields()->where('key', $key)->firstOrFail();
    $germanOptions = fn (string $category, string $key) => array_map(
        fn (array $option): string => $option['label']['de'],
        $field($category, $key)->options,
    );

    $diameter = $field('wheels_tires', 'diameter');
    expect([$diameter->unit, $diameter->min, $diameter->max, $diameter->step, $diameter->facet])->toBe(['in', 13.0, 24.0, 0.5, true]);

    $rear = $field('wheels_tires', 'diameter_rear');
    expect([$rear->unit, $rear->min, $rear->max, $rear->step, $rear->required])->toBe(['in', 13.0, 24.0, 0.5, false]);

    $offset = $field('wheels_tires', 'et_front');
    expect([$offset->min, $offset->max])->toBe([-50.0, 70.0]);

    expect($field('wheels_tires', 'width_rear')->step)->toBe(0.5)
        ->and($field('wheels_tires', 'tyre_size_front')->options['example'])->toBe('255/35 R19')
        ->and($field('wheels_tires', 'bolt_pattern')->options['example'])->toBe('5×120');

    expect($germanOptions('suspension', 'type'))->toBe(['Gewindefahrwerk', 'Luftfahrwerk', 'Tieferlegungsfedern', 'Sportdämpfer', 'Serie', 'Sonstiges'])
        ->and($germanOptions('exhaust', 'material'))->toBe(['Edelstahl', 'Titan', 'Sonstiges'])
        ->and($germanOptions('engine_performance', 'stage'))->toBe(['Stage 1', 'Stage 2', 'Stage 3', 'Individuell'])
        ->and($germanOptions('aero_body', 'part'))->toBe(['Frontlippe', 'Splitter', 'Seitenschweller', 'Diffusor', 'Heckflügel/Spoiler', 'Widebody', 'Motorhaube', 'Folierung', 'Lackierung', 'Sonstiges'])
        ->and($germanOptions('aero_body', 'material'))->toBe(['Carbon', 'GFK', 'ABS', 'Sonstiges'])
        ->and($germanOptions('interior', 'part'))->toBe(['Sitze', 'Lenkrad', 'Überrollkäfig', 'Gurte', 'Schaltknauf', 'Instrumente', 'Verkleidung', 'Sonstiges'])
        ->and($germanOptions('electronics', 'part'))->toBe(['Beleuchtung', 'Audio', 'Anzeigen', 'Datenlogger', 'Codierung', 'Sonstiges'])
        ->and($germanOptions('drivetrain', 'part'))->toBe(['Kupplung', 'Schwungrad', 'Sperrdifferenzial', 'Getriebe', 'Antriebswelle', 'Sonstiges']);

    $title = $field('other', 'title');
    expect([$title->type, $title->required])->toBe([ModFieldType::Text, true]);

    // Every select option carries both languages.
    foreach (ModCategory::query()->with('fields')->get() as $category) {
        foreach ($category->fields->where('type', ModFieldType::Select) as $select) {
            foreach ($select->options as $option) {
                expect($option['value'])->toBeString()->and($option['label']['de'])->toBeString()->and($option['label']['en'])->toBeString();
            }
        }
    }
});

it('seeds at least 150 brands with hints that are category keys', function () {
    $this->seed([ModCategorySeeder::class, BrandSeeder::class]);

    expect(Brand::query()->count())->toBeGreaterThanOrEqual(150);

    $keys = ModCategory::query()->pluck('key')->all();

    expect(Brand::query()->whereNotIn('category_hint', $keys)->count())->toBe(0);

    foreach (['BBS', 'KW', 'Akrapovič', 'Brembo', 'Recaro', 'Haltech', 'Michelin', 'Rays', 'Öhlins'] as $name) {
        expect(Brand::query()->where('name', $name)->exists())->toBeTrue($name);
    }

    expect(Brand::query()->where('name', 'Rays')->value('aliases'))->toContain('Volk Racing')
        ->and(Brand::query()->where('name', 'Akrapovič')->value('aliases'))->toContain('Akrapovic');
});

it('publishes every legal document in both languages without leaking the metadata block', function () {
    $this->seed(LegalDocumentSeeder::class);

    expect(LegalDocument::query()->count())->toBe(count(LegalDocumentKey::cases()) * 2);

    foreach (LegalDocument::query()->get() as $document) {
        expect($document->published_at)->not->toBeNull()
            ->and($document->version)->toBe('1')
            ->and($document->body_md)->toStartWith('# ')
            ->not->toContain('lawyer review')
            ->not->toContain('lorem');
    }

    $review = ConfigVersion::query()->where('key', LegalDocumentSeeder::REVIEW_KEY)->firstOrFail();

    expect($review->status)->toBe(ConfigVersionStatus::Draft)
        ->and($review->payload['documents']['privacy']['de']['status'])->toBe('draft')
        ->and($review->payload['documents']['terms']['en']['review'])->toContain('lawyer');
});

it('dates the legal documents to the demo clock where the demo seed runs, and to the day of the seed elsewhere', function (string $environment, bool $demoOnStaging, bool $demo) {
    app()->detectEnvironment(fn (): string => $environment);
    config(['speedclub.demo.seed_on_staging' => $demoOnStaging]);
    $this->travelTo('2026-11-06 09:30:00');

    // Directly: db:seed asks for confirmation in production and, without interaction, seeds nothing.
    app(LegalDocumentSeeder::class)->setContainer(app())->__invoke();

    // Before the QA clock (2026-11-02), and the same after every reseed: the legal pages show this date.
    expect(LegalDocument::query()->get()->map(fn (LegalDocument $document): ?string => $document->published_at?->format('Y-m-d H:i:s'))->unique()->values()->all())
        ->toBe([$demo ? DemoSeeder::NOW : '2026-11-06 09:30:00'])
        ->and(DemoSeeder::NOW < '2026-11-02')->toBeTrue();
})->with([
    'local' => ['local', false, true],
    'staging with the demo seed' => ['staging', true, true],
    'staging without it' => ['staging', false, false],
    'production' => ['production', true, false],
]);

it('states what the product promises in the legal drafts', function () {
    $this->seed(LegalDocumentSeeder::class);

    $body = fn (LegalDocumentKey $key, string $locale): string => LegalDocument::query()->where('key', $key)->where('locale', $locale)->value('body_md');

    expect($body(LegalDocumentKey::Imprint, 'de'))->toContain('[[Firmenname]]', '[[Anschrift]]', '§ 5 DDG')
        ->and($body(LegalDocumentKey::Privacy, 'de'))->toContain('keine Analyse-', 'Pusher', 'Expo', '30 Tage', 'keinen Cookie-Banner', 'Tageszähler')
        ->and($body(LegalDocumentKey::Terms, 'de'))->toContain('§ 315d StGB', '6 Monaten', 'Art. 17 DSA')
        ->and($body(LegalDocumentKey::Community, 'de'))->toContain('§ 315d StGB', 'reine Ästhetik', '6 Monaten')
        ->and($body(LegalDocumentKey::Community, 'en'))->toContain('§ 315d StGB', 'aesthetic only');
});

it('promises no report form while WEB-09 does not exist, and says when own scans are excluded', function () {
    $this->seed(LegalDocumentSeeder::class);

    foreach (LegalDocument::query()->get() as $document) {
        expect($document->body_md)->not->toContain('Webformular', 'web form', 'report form', 'Meldungen im Web');
    }

    $body = fn (LegalDocumentKey $key, string $locale): string => LegalDocument::query()->where('key', $key)->where('locale', $locale)->value('body_md');

    expect($body(LegalDocumentKey::Community, 'de'))->toContain('[[Melde-E-Mail]]')
        ->and($body(LegalDocumentKey::Terms, 'en'))->toContain('[[Melde-E-Mail]]')
        ->and($body(LegalDocumentKey::Privacy, 'de'))->toContain('im selben Browser angemeldet', 'setzen für Gäste keine Cookies')
        ->and($body(LegalDocumentKey::Privacy, 'en'))->toContain('signed in on the same browser', 'set no cookies for guests');
});

it('turns signature flags off in production and keeps AI flags off everywhere', function (string $environment, bool $signature) {
    app()->detectEnvironment(fn () => $environment);

    app(FeatureFlagSeeder::class)->setContainer(app())->__invoke();

    expect(FeatureFlag::query()->where('key', 'like', 'sig.%')->count())->toBe(14)
        ->and(FeatureFlag::query()->where('key', 'like', 'ai.%')->count())->toBe(6)
        ->and(FeatureFlag::query()->where('key', 'like', 'sig.%')->where('enabled', ! $signature)->count())->toBe(0)
        ->and(FeatureFlag::query()->where('key', 'like', 'ai.%')->where('enabled', true)->count())->toBe(0)
        // ADR-153 lifted with M2.7: the legal status follows the other sig.* flags, on outside production only.
        ->and(FeatureFlag::query()->where('key', 'sig.mod_legal_status')->value('enabled'))->toBe($signature);
})->with([
    'local' => ['local', true],
    'staging' => ['staging', true],
    'production' => ['production', false],
]);

it('turns the legal status of mods off in a database seeded before ADR-153, also when run twice', function () {
    FeatureFlag::query()->create(['key' => 'sig.mod_legal_status', 'enabled' => true]);
    FeatureFlag::query()->create(['key' => 'sig.compare', 'enabled' => true]);
    $this->seed([LegalDocumentSeeder::class, ConfigSeeder::class]);

    expect(app(AppConfig::class)->forLocale('de')['flags']['sig.mod_legal_status'])->toBeTrue();

    $migration = require database_path('migrations/2026_11_04_120000_turn_off_mod_legal_status.php');
    $migration->up();
    $migration->up();

    expect(FeatureFlag::query()->where('key', 'sig.mod_legal_status')->value('enabled'))->toBeFalse()
        ->and(FeatureFlag::query()->where('key', 'sig.compare')->value('enabled'))->toBeTrue()
        ->and(FeatureFlag::query()->count())->toBe(2)
        ->and(app(AppConfig::class)->forLocale('de')['flags']['sig.mod_legal_status'])->toBeFalse()
        ->and(app(AppConfig::class)->forLocale('en')['flags']['sig.mod_legal_status'])->toBeFalse();
});

it('publishes an app config the service can read', function () {
    $this->seed([LegalDocumentSeeder::class, FeatureFlagSeeder::class, ConfigSeeder::class]);

    $config = app(AppConfig::class)->forLocale('de');

    expect($config['min_version'])->toBe(['ios' => '0.1.0', 'android' => '0.1.0'])
        ->and($config['maintenance']['enabled'])->toBeFalse()
        ->and($config['branding']['logo'])->toEndWith('/brand/logo-wide-white-640.webp')
        ->and($config['flags'])->toHaveKey('sig.compare')
        ->and($config['legal_versions']['terms'])->toBe('1')
        ->and($config['branding']['welcome_hero'])->toBeNull();

    foreach (['logo', 'splash_image'] as $asset) {
        expect(file_exists(public_path((string) parse_url((string) $config['branding'][$asset], PHP_URL_PATH))))->toBeTrue($asset);
    }
});

it('creates roles and atoms on the staff guard with the spec bundles', function () {
    config(['speedclub.staff.owner_email' => 'owner@example.test']);

    $this->seed(StaffSeeder::class);

    expect(Permission::query()->where('guard_name', 'staff')->count())->toBe(57) // 56 of 06 §2 + lists.export (ADR-232)
        ->and(Role::query()->where('guard_name', 'staff')->pluck('name')->sort()->values()->all())
        ->toBe(['admin', 'analyst', 'content_editor', 'moderator', 'owner', 'support']);

    $atoms = fn (string $role): array => Role::findByName($role, 'staff')->permissions->pluck('name')->all();

    expect($atoms('owner'))->toHaveCount(57)
        ->and($atoms('admin'))->toHaveCount(57)
        ->and($atoms('analyst'))->toEqualCanonicalizing(['analytics.view', 'members.view', 'vehicles.view', 'qr.view', 'moderation.view'])
        ->and($atoms('content_editor'))->not->toContain('legal.publish')
        ->and($atoms('moderator'))->not->toContain('members.view_pii')
        ->and($atoms('support'))->toContain('members.view_pii')->not->toContain('members.edit');

    $owner = Staff::query()->where('email', 'owner@example.test')->firstOrFail();

    expect($owner->hasRole('owner'))->toBeTrue();
});

it('gives the owner the demo password only on local and staging', function (string $environment, bool $usesDemoPassword) {
    app()->detectEnvironment(fn () => $environment);
    config(['speedclub.staff.owner_email' => 'owner@example.test', 'speedclub.demo.staff_password' => 'demo-staff-password']);

    app(StaffSeeder::class)->setContainer(app())->__invoke();

    $owner = Staff::query()->where('email', 'owner@example.test')->firstOrFail();

    expect(password_verify('demo-staff-password', $owner->password))->toBe($usesDemoPassword)
        ->and(Staff::query()->where('email', 'moderator@speedclub.test')->exists())->toBe($usesDemoPassword);
})->with([
    'local' => ['local', true],
    'staging' => ['staging', true],
    'production' => ['production', false],
]);

it('keeps edits when the production seeders run again', function () {
    config(['speedclub.staff.owner_email' => 'owner@example.test']);
    $this->seed(DatabaseSeeder::class);

    $counts = fn (): array => [Make::query()->count(), Generation::query()->count(), Brand::query()->count(), LegalDocument::query()->count(), FeatureFlag::query()->count(), ConfigVersion::query()->count(), Staff::query()->count()];
    $before = $counts();

    FeatureFlag::query()->where('key', 'ai.translate')->update(['enabled' => true]);
    Brand::query()->where('name', 'BBS')->update(['category_hint' => 'other']);
    $password = Staff::query()->where('email', 'owner@example.test')->value('password');

    $this->seed(DatabaseSeeder::class);

    expect($counts())->toBe($before)
        ->and(FeatureFlag::query()->where('key', 'ai.translate')->value('enabled'))->toBeTrue()
        ->and(Brand::query()->where('name', 'BBS')->value('category_hint'))->toBe('other')
        ->and(Staff::query()->where('email', 'owner@example.test')->value('password'))->toBe($password);
});

it('runs the demo seeder only where it belongs', function (string $environment, bool $enabled, bool $runs) {
    app()->detectEnvironment(fn () => $environment);
    config(['speedclub.demo.seed_on_staging' => $enabled]);

    expect(DemoSeeder::runsAutomatically())->toBe($runs);
})->with([
    'local' => ['local', false, true],
    'testing' => ['testing', false, false],
    'staging, off' => ['staging', false, false],
    'staging, on' => ['staging', true, true],
    'production, flag on' => ['production', true, false],
]);
