<?php

use App\Enums\MediaStatus;
use App\Models\Crew;
use App\Models\Media;
use App\Models\User;
use Database\Seeders\ShowcaseCrewsSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * R4DQ-04: three sample crews get a real cover and a square logo through MediaService (re-encoded, variants, blurhash); the other two
 * keep none. Idempotent; badged samples like every crew of the seeder.
 */
function crewSeederRun(string $directory): void
{
    $seeder = new class($directory) extends ShowcaseCrewsSeeder
    {
        public function __construct(private readonly string $directory) {}

        protected function photoDirectory(): string
        {
            return $this->directory;
        }
    };

    $seeder->setContainer(app())->__invoke();
}

beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    config(['speedclub.media.disk' => 'public', 'speedclub.media.private_disk' => 'local', 'queue.default' => 'sync', 'speedclub.demo.photo_limit' => 99]);

    foreach (['lars.skyline', 'jan.s15', 'sebastian.demo', 'timo.rs', 'kai.c63', 'mia.s2k', 'felix.gt3', 'elias.amg', 'moritz.rx7', 'emma.typer'] as $username) {
        User::factory()->create(['username' => $username, 'is_sample' => true]);
    }

    $this->directory = sys_get_temp_dir().'/speedclub-crew-seed-'.uniqid();
    mkdir($this->directory);
    $entries = [];

    foreach (ShowcaseCrewsSeeder::MEDIA as [$cover, $logo]) {
        foreach ([$cover, $logo] as $file) {
            file_put_contents($this->directory.'/'.$file, UploadedFile::fake()->image($file, 640, 400)->getContent());
            $entries[] = ['file' => $file, 'alt_de' => 'Beispielfoto '.$file, 'focal' => ['x' => 0.4, 'y' => 0.5]];
        }
    }

    file_put_contents($this->directory.'/manifest.json', json_encode($entries));
});

afterEach(function () {
    array_map(unlink(...), glob($this->directory.'/*') ?: []);
    rmdir($this->directory);
});

it('gives three sample crews a processed cover and a square logo of their founder, and the other two none', function () {
    crewSeederRun($this->directory);

    $crews = Crew::query()->with(['logo', 'cover'])->get()->keyBy('name');

    expect($crews)->toHaveCount(5)
        ->and($crews->every(fn (Crew $crew): bool => $crew->is_sample === true))->toBeTrue();

    foreach (array_keys(ShowcaseCrewsSeeder::MEDIA) as $name) {
        $crew = $crews->get($name);

        foreach ([$crew->cover, $crew->logo] as $media) {
            expect($media)->toBeInstanceOf(Media::class)
                ->and($media->status)->toBe(MediaStatus::Ready)
                ->and($media->blurhash)->not->toBeNull()
                ->and($media->variants)->not->toBeEmpty()
                ->and($media->mediable_id)->toBe($crew->id)
                ->and($media->alt)->toStartWith('Beispielfoto');
        }

        expect($crew->logo->width)->toBe($crew->logo->height)
            ->and($crew->cover->width)->toBeGreaterThan($crew->cover->height)
            ->and($crew->cover->owner_id)->toBe($crew->founderMembership->user_id);
    }

    expect($crews->get('Nordlicht Youngtimer')->logo_media_id)->toBeNull()
        ->and($crews->get('Nordlicht Youngtimer')->cover_media_id)->toBeNull()
        ->and($crews->get('Elbflorenz Classics')->cover_media_id)->toBeNull();

    // Idempotent: a second run adds no photo and keeps the ones there.
    $ids = Media::query()->orderBy('id')->pluck('id')->all();
    crewSeederRun($this->directory);

    expect(Media::query()->orderBy('id')->pluck('id')->all())->toBe($ids)->and(Crew::query()->count())->toBe(5);
});

it('seeds no crew photo where the demo seeds no photos', function () {
    config(['speedclub.demo.photo_limit' => 0]);

    crewSeederRun($this->directory);

    expect(Crew::query()->count())->toBe(5)->and(Media::query()->count())->toBe(0);
});
