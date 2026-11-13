<?php

namespace App\Services\Showcase;

use App\Enums\EventLocationVisibility;
use App\Enums\EventStatus;
use App\Enums\EventType;
use App\Enums\EventVisibility;
use App\Enums\ModerationStatus;
use App\Enums\RsvpStatus;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\EventUpdate;
use App\Models\Media;
use App\Models\User;
use App\Services\Events\EventHousekeeping;
use App\Services\Events\EventLocation;
use App\Services\Media\MediaService;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * The 8 sample events of the showcase (09 §8.19, ADR-412, M4.12), from database/data/showcase/events.json: plausible meets without
 * "Beispiel" in their text (the app's badge says it, DQ-1112), organised by the SPEED CLUB Editorial account, is_sample, published, each
 * with its own cover from the graded seed photos. Dates count from now (Europe/Berlin), and roll() moves an event that is over forward
 * by whole weeks (events:housekeeping), so the showcase lists stay filled on a staging host. Seeded by DemoShowcaseSeeder (local and
 * staging only); `speedclub:demo --purge` removes them (ShowcasePurge). A sample event no longer in the data (a renamed one) goes.
 *
 * DQ-1110: the `member_events` of the file are meets of classic demo members (DemoSeeder; not samples, so they show whatever
 * editorial_samples says): one upcoming that members can answer, with going and interested demo members, an organiser update and the
 * exact place, and one that is over. Only where those members exist.
 */
class ShowcaseEvents
{
    public const EDITORIAL = 'speedclub.editorial';

    /** Marks the covers this class imported (media.sample_source), so a re-run reuses them. */
    private const COVER_SOURCE = 'event-cover:';

    /** @var array<string, array{alt: string|null, focal_x: float|null, focal_y: float|null, thumbhash: string|null}>|null */
    private ?array $manifest = null;

    private ?string $photos = null;

    /**
     * @return int events written
     */
    public function seed(?CarbonImmutable $now = null, ?string $photos = null): int
    {
        Showcase::assertEnvironment('ShowcaseEvents');
        $now ??= CarbonImmutable::now();
        $this->photos = $photos ?? base_path('../design/seed-photos');
        $this->manifest = null;
        $data = $this->data();
        $organiser = User::query()->where('username', self::EDITORIAL)->where('is_sample', true)->first();

        if (! $organiser instanceof User) {
            return 0;
        }

        $events = [];

        foreach ($data['events'] as $row) {
            $starts = $this->start($row['weekday'], $row['weeks'], $row['start'], $now);
            [$areaLat, $areaLng] = EventLocation::area($row['lat'], $row['lng']);
            $slug = self::slug($row['key'], $row['title']);
            $event = Event::query()->where('slug', $slug)->first() ?? new Event;

            if ($event->exists && $event->getAttribute('is_sample') !== true) {
                throw new RuntimeException("A real event already uses the sample slug [$slug].");
            }

            $event->forceFill([
                'organiser_id' => $organiser->id,
                'slug' => $slug,
                'title' => $row['title'],
                'type' => EventType::from($row['type']),
                'status' => EventStatus::Published,
                'visibility' => EventVisibility::Public,
                'location_visibility' => EventLocationVisibility::from($row['location_visibility']),
                'starts_at' => $starts->utc(),
                'ends_at' => $starts->addHours($row['hours'])->utc(),
                'timezone' => 'Europe/Berlin',
                'venue_name' => $row['venue_name'],
                'street' => $row['street'],
                'postcode' => $row['postcode'],
                'city' => $row['city'],
                'country' => 'DE',
                'lat' => $row['lat'],
                'lng' => $row['lng'],
                'area_lat' => $areaLat,
                'area_lng' => $areaLng,
                'description' => $row['description'],
                'organiser_rules' => $row['organiser_rules'],
                'rules' => $row['rules'],
                'rules_accepted_at' => $now,
                'capacity' => $row['capacity'],
                'submitted_at' => $now,
                'published_at' => $now,
                'reminded_24h_at' => null,
                'reminded_2h_at' => null,
                'is_sample' => true,
            ])->save();
            $this->cover($event, $organiser, $row['cover'] ?? null);
            $events[$row['key']] = $event;
        }

        // A sample event of the Editorial account that is no longer in the data (DQ-1112 renamed them, and the slug follows the title).
        $slugs = array_map(fn (Event $event): string => (string) $event->slug, array_values($events));

        foreach (Event::query()->where('is_sample', true)->where('organiser_id', $organiser->id)->whereNotIn('slug', $slugs)->get() as $stale) {
            app(EventHousekeeping::class)->delete($stale);
        }

        foreach ($data['rsvps'] as $row) {
            $member = User::query()->where('username', $row['member'])->where('is_sample', true)->first();
            $event = $events[$row['event']] ?? null;

            if ($member instanceof User && $event instanceof Event) {
                EventRsvp::query()->updateOrCreate(
                    ['event_id' => $event->id, 'user_id' => $member->id],
                    ['status' => RsvpStatus::from($row['status']), 'status_at' => $now],
                );
            }
        }

        $this->seedMemberEvents($data['member_events'] ?? [], $now);

        return count($events);
    }

    /**
     * DQ-1110: meets of classic demo members that a member can answer (EVT-02's main state) and one that is over (EVT-05 Vergangen).
     *
     * @param  list<array<string, mixed>>  $rows
     */
    private function seedMemberEvents(array $rows, CarbonImmutable $now): void
    {
        foreach ($rows as $row) {
            $organiser = User::query()->where('username', (string) $row['organiser'])->where('is_sample', false)->first();

            if (! $organiser instanceof User) {
                continue;
            }

            [$hour, $minute] = array_map(intval(...), explode(':', (string) $row['start']));
            $starts = $now->setTimezone('Europe/Berlin')->addDays((int) $row['days'])->setTime($hour, $minute);
            [$areaLat, $areaLng] = EventLocation::area((float) $row['lat'], (float) $row['lng']);
            $slug = self::slug((string) $row['key'], (string) $row['title']);
            $event = Event::query()->where('slug', $slug)->first() ?? new Event;

            if ($event->exists && $event->organiser_id !== $organiser->id) {
                throw new RuntimeException("Another member's event already uses the demo slug [$slug].");
            }

            $published = ($starts->lessThan($now) ? $starts : $now)->subDays(5);
            $event->forceFill([
                'organiser_id' => $organiser->id,
                'slug' => $slug,
                'title' => $row['title'],
                'type' => EventType::from((string) $row['type']),
                'status' => EventStatus::Published,
                'visibility' => EventVisibility::Public,
                'location_visibility' => EventLocationVisibility::from((string) $row['location_visibility']),
                'starts_at' => $starts->utc(),
                'ends_at' => $starts->addHours((int) $row['hours'])->utc(),
                'timezone' => 'Europe/Berlin',
                'venue_name' => $row['venue_name'],
                'street' => $row['street'],
                'postcode' => $row['postcode'],
                'city' => $row['city'],
                'country' => 'DE',
                'lat' => $row['lat'],
                'lng' => $row['lng'],
                'area_lat' => $areaLat,
                'area_lng' => $areaLng,
                'description' => $row['description'],
                'organiser_rules' => $row['organiser_rules'],
                'rules' => $row['rules'],
                'rules_accepted_at' => $published,
                'capacity' => $row['capacity'],
                'submitted_at' => $published,
                // The organiser's first events go through review (ADM-53): approved by the team before they went live.
                'reviewed_at' => $published,
                'published_at' => $published,
                'reminded_24h_at' => null,
                'reminded_2h_at' => null,
                'is_sample' => false,
            ])->save();
            $this->cover($event, $organiser, is_string($row['cover'] ?? null) ? $row['cover'] : null);

            $answered = [];

            foreach (['going' => RsvpStatus::Going, 'interested' => RsvpStatus::Interested] as $key => $status) {
                foreach (is_array($row[$key] ?? null) ? $row[$key] : [] as $index => $username) {
                    $member = User::query()->where('username', (string) $username)->where('is_sample', false)->first();

                    if ($member instanceof User && ! $member->is($organiser)) {
                        EventRsvp::query()->updateOrCreate(
                            ['event_id' => $event->id, 'user_id' => $member->id],
                            ['status' => $status, 'status_at' => $published->addHours(2 + $index * 5), 'removed_at' => null],
                        );
                        $answered[] = $member->id;
                    }
                }
            }

            EventRsvp::query()->where('event_id', $event->id)->whereNotIn('user_id', $answered)->delete();
            EventUpdate::query()->where('event_id', $event->id)->delete();

            foreach (is_array($row['updates'] ?? null) ? $row['updates'] : [] as $update) {
                $at = $now->subHours((int) $update['hours_ago']);
                $entry = new EventUpdate(['event_id' => $event->id, 'author_id' => $organiser->id, 'body' => (string) $update['body']]);
                $entry->forceFill(['created_at' => $at, 'updated_at' => $at])->save();
            }
        }
    }

    /**
     * The event's cover from the graded seed photo (processed/<name>-2048.jpg) only, so every sample cover carries the editorial grade
     * (09 §4.6); without that file the event keeps no cover rather than an ungraded one. Imported once (sample_source), approved, with
     * the manifest's alt text, focal point and ThumbHash; another photo before replaces it.
     */
    private function cover(Event $event, User $organiser, ?string $file): void
    {
        if ($file === null) {
            return;
        }

        $source = self::COVER_SOURCE.$file;
        $current = $event->getAttribute('cover_media_id');
        $media = is_string($current) ? Media::query()->find($current) : null;

        if ($media instanceof Media && $media->getAttribute('sample_source') === $source) {
            return;
        }

        $path = ShowcasePhotos::gradedPath((string) $this->photos, $file);

        if ($path === null) {
            return;
        }

        $meta = $this->manifest()[$file] ?? ['alt' => null, 'focal_x' => null, 'focal_y' => null, 'thumbhash' => null];
        $service = app(MediaService::class);
        $imported = $service->storeFromPath($path, $organiser, $event, ['alt' => $meta['alt'], 'focal_x' => $meta['focal_x'], 'focal_y' => $meta['focal_y']]);
        $imported->forceFill(['sample_source' => $source, 'moderation_status' => ModerationStatus::Approved, 'thumbhash' => $meta['thumbhash']])->save();

        $event->forceFill(['cover_media_id' => $imported->id])->save();

        if ($media instanceof Media) {
            $service->purge($media);
        }
    }

    /**
     * @return array<string, array{alt: string|null, focal_x: float|null, focal_y: float|null, thumbhash: string|null}>
     */
    private function manifest(): array
    {
        if ($this->manifest !== null) {
            return $this->manifest;
        }

        $path = rtrim((string) $this->photos, '/').'/manifest.json';
        $entries = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
        $this->manifest = [];

        foreach (is_array($entries) ? $entries : [] as $entry) {
            if (! is_array($entry) || ! is_string($entry['file'] ?? null)) {
                continue;
            }

            $focal = is_array($entry['focal'] ?? null) ? $entry['focal'] : [];
            $thumbhash = $entry['thumbhash'] ?? null;
            $this->manifest[$entry['file']] = [
                'alt' => is_string($entry['alt_de'] ?? null) ? $entry['alt_de'] : null,
                'focal_x' => is_numeric($focal['x'] ?? null) ? (float) $focal['x'] : null,
                'focal_y' => is_numeric($focal['y'] ?? null) ? (float) $focal['y'] : null,
                'thumbhash' => is_string($thumbhash) && preg_match('/\A[A-Za-z0-9+\/]{6,60}={0,2}\z/', $thumbhash) === 1 ? $thumbhash : null,
            ];
        }

        return $this->manifest;
    }

    /**
     * Sample events that are over move forward by whole weeks (same weekday and time), with their reminders reset.
     *
     * @return int events moved
     */
    public function roll(?CarbonImmutable $now = null): int
    {
        $now ??= CarbonImmutable::now();
        $moved = 0;

        // The upcoming demo meet of DQ-1110 rolls with the samples, so EVT-02's main state stays capturable; the past one stays past.
        $memberSlugs = array_values(array_map(fn (array $row): string => self::slug((string) $row['key'], (string) $row['title']),
            array_filter($this->data()['member_events'] ?? [], fn (array $row): bool => (int) $row['days'] >= 0)));

        $over = Event::query()->where(fn ($query) => $query->where('is_sample', true)->orWhereIn('slug', $memberSlugs))
            ->where('status', EventStatus::Published->value)->where('ends_at', '<', $now)->limit(100)->get();

        foreach ($over as $event) {
            if ($event->starts_at === null || $event->ends_at === null) {
                continue;
            }

            $weeks = (int) ceil(max(1, $event->ends_at->diffInDays($now)) / 7);
            $event->forceFill([
                'starts_at' => $event->starts_at->addWeeks($weeks),
                'ends_at' => $event->ends_at->addWeeks($weeks),
                'reminded_24h_at' => null,
                'reminded_2h_at' => null,
            ])->save();
            $moved++;
        }

        return $moved;
    }

    /**
     * "beispiel-treffen-hafen-x7k2m9": the title and six characters from the key, the same on every run.
     */
    public static function slug(string $key, string $title): string
    {
        $suffix = substr(strtr(base64_encode(hash('sha256', 'speedclub-showcase:event:'.$key, true)), ['+' => '', '/' => '', '=' => '']), 0, 6);

        return Str::slug($title, '-', 'de').'-'.strtolower($suffix);
    }

    private function start(int $weekday, int $weeks, string $time, CarbonImmutable $now): CarbonImmutable
    {
        $local = $now->setTimezone('Europe/Berlin');
        [$hour, $minute] = array_map(intval(...), explode(':', $time));
        $day = $local->isoWeekday() === $weekday && $local->setTime($hour, $minute)->isFuture() ? $local : $local->next($weekday % 7);

        return $day->addWeeks($weeks)->setTime($hour, $minute);
    }

    /**
     * @return array{events: list<array{key: string, title: string, type: string, city: string, postcode: string, venue_name: string, street: string, lat: float, lng: float, weekday: int, weeks: int, start: string, hours: int, location_visibility: string, capacity: int|null, description: string, organiser_rules: string|null, rules: list<string>, cover?: string|null}>, rsvps: list<array{member: string, event: string, status: string}>, member_events?: list<array<string, mixed>>}
     */
    private function data(): array
    {
        /** @var array{events: list<array{key: string, title: string, type: string, city: string, postcode: string, venue_name: string, street: string, lat: float, lng: float, weekday: int, weeks: int, start: string, hours: int, location_visibility: string, capacity: int|null, description: string, organiser_rules: string|null, rules: list<string>, cover?: string|null}>, rsvps: list<array{member: string, event: string, status: string}>, member_events?: list<array<string, mixed>>} */
        return json_decode((string) file_get_contents(database_path('data/showcase/events.json')), true, 32, JSON_THROW_ON_ERROR);
    }
}
