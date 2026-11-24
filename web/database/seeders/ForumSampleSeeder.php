<?php

namespace Database\Seeders;

use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Enums\MediaCategory;
use App\Enums\ModerationStatus;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Forum\ForumCounters;
use App\Services\Forum\ForumSearchKeys;
use App\Services\Media\MediaService;
use App\Services\Showcase\ShowcasePhotos;
use App\Services\Showcase\ShowcasePlates;
use Carbon\CarbonImmutable;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * M5.8 forum samples (10 §7 "Seed 25 realistic sample threads with replies on staging", m5.8-contract §8), local, staging and testing
 * only: 25 German threads by the showcase members (database/data/showcase/forum.json) with replies, a few answers, solutions and
 * "Hilfreich" votes from other sample members. Every row is_sample: shown only while editorial_samples is on, badged "Beispiel". No
 * speeds, lap times or legality verdicts. Needs DemoShowcaseSeeder's members and ForumCategorySeeder; a thread whose author or category
 * is missing is skipped.
 *
 * DQ-P5-005 (design QA P5 r1): threads about the author's own car carry that showcase car (`vehicle`, a data key of vehicles.json, only
 * when the author owns it), and threads carry topic-true licensed photos (`photos`, design/seed-photos, graded rendition, Unsplash License,
 * CREDITS.md) on their opening post through the media pipeline (re-encode, EXIF gone, variants, blurhash, plate blur as the showcase).
 * The photos are ones no other sample entity shows (no event cover, no build's gallery photo of another car).
 *
 * Runs again safely: a host without sample threads gets them; a host that has them (staging) only gets the cars and photos brought in
 * line with this data (by thread title and author; media remember their file in sample_source), counts, answers and votes untouched.
 */
class ForumSampleSeeder extends Seeder
{
    use SeedsFromData;

    /** media.sample_source of a forum photo: this prefix and the seed file. */
    public const PHOTO_SOURCE = 'forum:';

    /** @var array<string, array{alt: string|null, focal_x: float|null, focal_y: float|null, thumbhash: string|null}>|null */
    private ?array $manifest = null;

    private ?string $photos = null;

    /**
     * The seed photo folder of the showcase run that calls this seeder (a test points it at its own).
     */
    public function withPhotos(string $directory): static
    {
        $this->photos = $directory;

        return $this;
    }

    public function run(ForumSearchKeys $keys, ForumCounters $counters): void
    {
        if (! app()->environment(['local', 'staging', 'testing'])) {
            return;
        }

        /** @var list<array<string, mixed>> $threads */
        $threads = $this->readJson('showcase/forum.json');
        $members = User::query()->where('is_sample', true)->whereNotNull('username')->get()->keyBy('username');

        if (ForumThread::withTrashed()->where('is_sample', true)->exists()) {
            foreach ($threads as $data) {
                $author = $members->get((string) $data['author']);
                $thread = $author instanceof User
                    ? ForumThread::query()->where('is_sample', true)->where('user_id', $author->id)->where('title', (string) $data['title'])->first()
                    : null;

                if ($thread instanceof ForumThread) {
                    $this->illustrate($thread, $author, $data, $keys);
                }
            }

            return;
        }

        $voters = $members->values();
        $now = CarbonImmutable::now();

        DB::transaction(function () use ($threads, $members, $voters, $now, $keys, $counters): void {
            foreach ($threads as $index => $data) {
                $author = $members->get((string) $data['author']);
                $category = ForumCategory::query()->where('slug', (string) $data['category'])->first();

                if (! $author instanceof User || ! $category instanceof ForumCategory) {
                    continue;
                }

                $at = $now->subDays((int) $data['days'])->setTime(9 + $index % 10, ($index * 7) % 60);
                $thread = new ForumThread;
                $thread->forceFill([
                    'category_id' => $category->id,
                    'user_id' => $author->id,
                    'title' => (string) $data['title'],
                    'slug' => Str::slug((string) $data['title']),
                    'status' => ForumThreadStatus::Published,
                    'tags' => $data['tags'] ?? null,
                    'last_activity_at' => $at,
                    'published_at' => $at,
                    'title_keys' => '',
                    'is_sample' => true,
                    'created_at' => $at,
                    'updated_at' => $at,
                ])->save();

                $this->post($thread, $author, (string) $data['body'], true, null, $at);
                DB::table('forum_subscriptions')->insertOrIgnore(['thread_id' => $thread->id, 'user_id' => $author->id, 'created_at' => $at]);

                $replies = [];
                $step = 0;

                foreach ((array) ($data['replies'] ?? []) as $reply) {
                    $replyAuthor = $members->get((string) $reply['author']);

                    if (! $replyAuthor instanceof User) {
                        continue;
                    }

                    $replyAt = $at->addHours(2 + 5 * $step++);
                    $post = $this->post($thread, $replyAuthor, (string) $reply['body'], false, null, $replyAt, (int) ($reply['helpful'] ?? 0));
                    $replies[] = $post;
                    $this->votes($post, array_values($voters->reject(fn (User $member): bool => $member->is($replyAuthor))->all()), (int) ($reply['helpful'] ?? 0), $replyAt);

                    foreach ((array) ($reply['children'] ?? []) as $child) {
                        $childAuthor = $members->get((string) $child['author']);

                        if ($childAuthor instanceof User) {
                            $this->post($thread, $childAuthor, (string) $child['body'], false, $post->id, $replyAt->addHour());
                        }
                    }
                }

                $solution = $data['solution'] ?? null;

                if (is_int($solution) && isset($replies[$solution])) {
                    $thread->forceFill(['solved_post_id' => $replies[$solution]->id, 'solved_at' => $replies[$solution]->created_at])->save();
                }

                $keys->refresh($thread);
                $counters->thread($thread);
                $this->illustrate($thread, $author, $data, $keys);
            }

            $counters->category(...ForumCategory::query()->pluck('id')->map(intval(...))->all());
        });
    }

    /**
     * DQ-P5-005: the author's car (when the data names one the author owns) and the opening post's photos, brought in line with the data:
     * a photo already imported (its sample_source) stays, one no longer listed goes.
     *
     * @param  array<string, mixed>  $data
     */
    private function illustrate(ForumThread $thread, User $author, array $data, ForumSearchKeys $keys): void
    {
        $vehicleId = null;

        if (is_string($data['vehicle'] ?? null)) {
            $vehicleId = Vehicle::query()->where('public_id', DemoShowcaseSeeder::publicIdFor($data['vehicle']))->where('owner_id', $author->id)->value('id');
        }

        if ($thread->vehicle_id !== $vehicleId) {
            $thread->forceFill(['vehicle_id' => $vehicleId, 'modification_id' => null]);
            $thread->timestamps = false;
            $thread->save();
            $thread->timestamps = true;
            $keys->refresh($thread);
        }

        $opening = ForumPost::query()->where('thread_id', $thread->id)->where('is_opening', true)->first();

        if (! $opening instanceof ForumPost) {
            return;
        }

        $directory = $this->photos ?? base_path('../design/seed-photos');
        $manifest = $this->photoManifest($directory);
        $service = app(MediaService::class);
        $existing = Media::query()->where('mediable_type', $opening->getMorphClass())->where('mediable_id', $opening->id)->whereNotNull('sample_source')->get()->keyBy('sample_source');
        $wanted = [];

        foreach (array_values(array_filter((array) ($data['photos'] ?? []), is_string(...))) as $index => $file) {
            $source = self::PHOTO_SOURCE.$file;
            $path = ShowcasePhotos::gradedPath($directory, $file);
            $meta = $manifest[$file] ?? null;

            if ($path === null || $meta === null) {
                $this->command?->warn("design/seed-photos: no graded $file, the forum sample stays without it.");

                continue;
            }

            $wanted[] = $source;

            if ($existing->has($source)) {
                continue;
            }

            $media = $service->storeFromPath($path, $author, $opening, [
                'alt' => $meta['alt'],
                'focal_x' => $meta['focal_x'],
                'focal_y' => $meta['focal_y'],
                'category' => MediaCategory::Other,
                'sort' => $index,
            ], ShowcasePlates::for($directory)->choice($file));
            $media->forceFill(['sample_source' => $source, 'moderation_status' => ModerationStatus::Approved, 'thumbhash' => $meta['thumbhash']])->save();
        }

        foreach ($existing as $source => $media) {
            if (! in_array($source, $wanted, true) && str_starts_with((string) $source, self::PHOTO_SOURCE)) {
                $service->purge($media);
            }
        }
    }

    /**
     * file => the manifest's alt text (German), focal point and ThumbHash.
     *
     * @return array<string, array{alt: string|null, focal_x: float|null, focal_y: float|null, thumbhash: string|null}>
     */
    private function photoManifest(string $directory): array
    {
        if ($this->manifest !== null) {
            return $this->manifest;
        }

        $entries = json_decode((string) @file_get_contents($directory.'/manifest.json'), true);
        $this->manifest = [];

        foreach (is_array($entries) ? $entries : [] as $entry) {
            if (is_array($entry) && is_string($entry['file'] ?? null)) {
                $focal = is_array($entry['focal'] ?? null) ? $entry['focal'] : [];
                $this->manifest[$entry['file']] = [
                    'alt' => is_string($entry['alt_de'] ?? null) ? $entry['alt_de'] : null,
                    'focal_x' => is_numeric($focal['x'] ?? null) ? (float) $focal['x'] : null,
                    'focal_y' => is_numeric($focal['y'] ?? null) ? (float) $focal['y'] : null,
                    'thumbhash' => is_string($entry['thumbhash'] ?? null) ? $entry['thumbhash'] : null,
                ];
            }
        }

        return $this->manifest;
    }

    private function post(ForumThread $thread, User $author, string $body, bool $opening, ?string $parentId, CarbonImmutable $at, int $helpful = 0): ForumPost
    {
        $post = new ForumPost;
        $post->forceFill([
            'thread_id' => $thread->id,
            'user_id' => $author->id,
            'parent_id' => $parentId,
            'is_opening' => $opening,
            'status' => ForumPostStatus::Published,
            'helpful_count' => 0,
            'published_at' => $at,
            'is_sample' => true,
            'created_at' => $at,
            'updated_at' => $at,
        ])->writeBody($body)->save();

        return $post;
    }

    /**
     * "Hilfreich" from other sample members only: the count is what the rows say, never an invented number.
     *
     * @param  list<User>  $voters
     */
    private function votes(ForumPost $post, array $voters, int $count, CarbonImmutable $at): void
    {
        foreach (array_slice($voters, 0, $count) as $voter) {
            DB::table('forum_votes')->insertOrIgnore(['post_id' => $post->id, 'user_id' => $voter->id, 'created_at' => $at]);
        }

        $post->forceFill(['helpful_count' => DB::table('forum_votes')->where('post_id', $post->id)->count()])->saveQuietly();
    }
}
