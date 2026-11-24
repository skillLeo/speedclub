<?php

namespace Database\Seeders;

use App\Enums\Bundesland;
use App\Enums\CrewJoinMode;
use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use App\Enums\MediaCategory;
use App\Enums\ModerationStatus;
use App\Models\Crew;
use App\Models\CrewMember;
use App\Models\Media;
use App\Models\User;
use App\Services\Crews\CrewListing;
use App\Services\Crews\CrewMemberships;
use App\Services\Crews\CrewNames;
use App\Services\Media\MediaService;
use App\Services\Media\PlateBlurChoice;
use App\Services\Showcase\ShowcasePlates;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * R4-2.3: sample crews of the showcase members (09 §8.19 "Beispiel" content: is_sample, shown only while editorial_samples is on), for
 * local and staging only. Idempotent: a crew that exists by name is left alone. Members that are missing are skipped.
 *
 * R4DQ-04: three of the five get a real cover and logo from design/seed-photos (the graded rendition when there is one), stored through
 * MediaService like an upload (re-encoded, metadata stripped, WebP variants, blurhash, private original) and owned by the founder; the
 * logo is a square crop. The other two keep none, so the lists show both kinds. Idempotent: a slot that is filled is left alone; only
 * where the demo seeds photos at all (speedclub.demo.photo_limit, 0 in the seeder tests that stay off the real disks).
 */
class ShowcaseCrewsSeeder extends Seeder
{
    /**
     * name, Bundesland, join mode, days ago, description, founder, admins, members (showcase usernames).
     *
     * @var list<array{0: string, 1: Bundesland|null, 2: CrewJoinMode, 3: int, 4: string, 5: string, 6: list<string>, 7: list<string>}>
     */
    private const CREWS = [
        ['Nordlicht Youngtimer', Bundesland::HH, CrewJoinMode::Open, 41, 'Youngtimer zwischen Elbe und Ostsee. Jeden ersten Sonntag im Monat Kaffee und Benzingespräche am Hafen, sonst Ausfahrten an die Küste.', 'lars.skyline', ['jan.s15'], ['hannah.mx5', 'nele.scirocco']],
        ['Isar Stance Club', Bundesland::BY, CrewJoinMode::Request, 33, 'Tiefer, breiter, sauber gemacht: Fahrwerk, Felgen, Fitment. Wir schrauben zusammen in Garching und fahren im Sommer zu den großen Treffen.', 'sebastian.demo', ['timo.rs'], ['niklas.z33', 'fabian.e92', 'david.supra']],
        ['JDM Ruhrpott', Bundesland::NW, CrewJoinMode::Open, 26, 'Japanische Autos aus dem Pott: Skyline, Supra, Civic und alles dazwischen. Stammtisch jeden zweiten Freitag in Essen.', 'kai.c63', ['mia.s2k'], ['marie.gr86', 'tim.sti', 'jonas.e46']],
        ['Schwaben Schrauber', Bundesland::BW, CrewJoinMode::Invite, 18, 'Kleine Runde aus Stuttgart und Umgebung. Wir helfen uns bei Projekten, teilen Werkzeug und Hallenplatz. Neue Leute kommen über Einladung dazu.', 'felix.gt3', [], ['elias.amg', 'sophie.quattro', 'jana.718']],
        ['Elbflorenz Classics', Bundesland::SN, CrewJoinMode::Request, 9, 'Klassiker und Youngtimer aus Dresden und Leipzig. Frühjahrsausfahrt, Herbsttreffen und zwischendurch gemeinsame Werkstatttage.', 'moritz.rx7', ['emma.typer'], ['laura.golf2']],
    ];

    /**
     * Crew name => [cover file, logo file]: photos the crew could have taken itself (no parts-brand close-up, no other crew's photo).
     *
     * @var array<string, array{0: string, 1: string}>
     */
    public const MEDIA = [
        'JDM Ruhrpott' => ['generic-exterior-04.jpg', 'generic-engine-02.jpg'],
        'Isar Stance Club' => ['honda-s2000-04.jpg', 'generic-interior-03.jpg'],
        'Schwaben Schrauber' => ['cover-workshop-01.jpg', 'cover-workshop-03.jpg'],
    ];

    public function run(CrewMemberships $memberships): void
    {
        if (! app()->environment(['local', 'staging', 'testing'])) {
            return;
        }

        $usernames = [];
        foreach (self::CREWS as $crew) {
            $usernames = [...$usernames, $crew[5], ...$crew[6], ...$crew[7]];
        }

        $members = User::query()->where('is_sample', true)->whereIn('username', array_unique($usernames))->get()->keyBy('username');
        $now = CarbonImmutable::now();

        foreach (self::CREWS as [$name, $bundesland, $mode, $days, $description, $founder, $admins, $plain]) {
            $owner = $members->get($founder);

            if (! $owner instanceof User || Crew::withTrashed()->where('name_key', CrewNames::key($name))->exists()) {
                continue;
            }

            DB::transaction(function () use ($memberships, $members, $now, $name, $bundesland, $mode, $days, $description, $owner, $admins, $plain): void {
                $at = $now->subDays($days)->setTime(18, 30);
                $crew = new Crew;
                $crew->forceFill([
                    'name' => $name,
                    'name_key' => CrewNames::key($name),
                    'slug' => CrewNames::slugFor($name),
                    'description' => $description,
                    'bundesland' => $bundesland,
                    'join_mode' => $mode,
                    'status' => CrewStatus::Active,
                    'members_count' => 0,
                    'is_sample' => true,
                    'created_at' => $at,
                    'updated_at' => $at,
                ])->save();

                $roles = [[$owner, CrewRole::Founder]];
                foreach ($admins as $username) {
                    $roles[] = [$members->get($username), CrewRole::Admin];
                }
                foreach ($plain as $username) {
                    $roles[] = [$members->get($username), CrewRole::Member];
                }

                foreach ($roles as $index => [$user, $role]) {
                    if (! $user instanceof User || CrewMember::query()->where('user_id', $user->id)->count() >= config()->integer('speedclub.crews.memberships_max')) {
                        continue;
                    }

                    $member = new CrewMember;
                    $member->forceFill([
                        'crew_id' => $crew->id,
                        'user_id' => $user->id,
                        'role' => $role,
                        'role_rank' => $role->rank(),
                        'joined_at' => $at->addDays($index),
                    ])->save();
                }

                $memberships->recount($crew);
            });
        }

        $this->media();
    }

    private ?string $photos = null;

    /**
     * The seed photo folder of the showcase run that calls this seeder (a test points it at its own).
     */
    public function withPhotos(string $directory): static
    {
        $this->photos = $directory;

        return $this;
    }

    /** The seed photos (manifest.json and its files). A test points this at its own folder. */
    protected function photoDirectory(): string
    {
        return $this->photos ?? base_path('../design/seed-photos');
    }

    private function media(): void
    {
        if (config()->integer('speedclub.demo.photo_limit', 0) === 0) {
            return;
        }

        $directory = $this->photoDirectory();
        $manifest = is_file($directory.'/manifest.json') ? json_decode((string) file_get_contents($directory.'/manifest.json'), true) : null;
        $photos = collect(is_array($manifest) ? $manifest : [])->filter(fn (mixed $row): bool => is_array($row) && is_string($row['file'] ?? null))->keyBy('file');
        $plates = ShowcasePlates::for($directory);
        $service = app(MediaService::class);

        foreach (self::MEDIA as $name => [$coverFile, $logoFile]) {
            $crew = Crew::query()->where('is_sample', true)->where('name_key', CrewNames::key($name))->first();
            $founder = $crew instanceof Crew ? CrewListing::founderOf($crew)?->user : null;

            if (! $crew instanceof Crew || ! $founder instanceof User) {
                continue;
            }

            foreach (['cover_media_id' => [$coverFile, false], 'logo_media_id' => [$logoFile, true]] as $column => [$file, $square]) {
                $photo = $photos->get($file);

                if (! is_array($photo) || ($crew->getAttribute($column) !== null && Media::query()->whereKey($crew->getAttribute($column))->exists())) {
                    continue;
                }

                $graded = $directory.'/processed/'.pathinfo($file, PATHINFO_FILENAME).'-2048.jpg';
                $path = is_file($graded) ? $graded : $directory.'/'.$file;
                $focalX = is_numeric($photo['focal']['x'] ?? null) ? (float) $photo['focal']['x'] : 0.5;
                $focalY = is_numeric($photo['focal']['y'] ?? null) ? (float) $photo['focal']['y'] : 0.5;
                $alt = is_string($photo['alt_de'] ?? null) ? $photo['alt_de'] : null;
                $temporary = null;

                if ($square) {
                    [$temporary, $plate] = $this->squareCrop($path, $file, $plates, $focalX, $focalY);
                    $attributes = ['alt' => $alt, 'category' => MediaCategory::Other];
                } else {
                    $plate = $plates->choice($file);
                    $attributes = ['alt' => $alt, 'focal_x' => $focalX, 'focal_y' => $focalY, 'category' => MediaCategory::Other];
                }

                try {
                    $media = $service->storeFromPath($temporary ?? $path, $founder, $crew, $attributes, $plate);
                } finally {
                    if ($temporary !== null) {
                        @unlink($temporary);
                    }
                }

                $media->forceFill(['sample_source' => 'crew:'.($square ? 'logo:' : 'cover:').$file, 'moderation_status' => ModerationStatus::Approved])->save();
                $crew->forceFill([$column => $media->id])->saveQuietly();
            }
        }
    }

    /**
     * A square crop around the focal point (the logo slot is square) and the plate decision moved into it.
     *
     * @return array{0: string, 1: PlateBlurChoice}
     */
    private function squareCrop(string $path, string $file, ShowcasePlates $plates, float $focalX, float $focalY): array
    {
        $image = @imagecreatefromstring((string) file_get_contents($path));

        if ($image === false) {
            throw new RuntimeException("Seed photo [$file] cannot be decoded for a crew logo.");
        }

        $width = imagesx($image);
        $height = imagesy($image);
        [$x, $y, $side] = ShowcasePlates::squareAround($width, $height, $focalX, $focalY);
        $size = max(1, min(800, $side));
        $square = imagecreatetruecolor($size, $size);
        imagecopyresampled($square, $image, 0, 0, $x, $y, $size, $size, $side, $side);
        $target = storage_path('framework/cache/showcase-crew-logo-'.Str::random(12).'.jpg');
        imagejpeg($square, $target, 90);

        return [$target, $plates->forCrop($file, $width, $height, $x, $y, $side, $side)];
    }
}
