<?php

namespace App\Http\Controllers\Admin\Members;

use App\Models\Staff;
use App\Models\User;
use App\Models\Wrapped;
use App\Services\Audit\Audit;
use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedPresenter;
use App\Services\Wrapped\WrappedReleases;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;

/**
 * ADM-10 tab "Wrapped" (m5.9e contract §2, M5.9e admin): the member's generated seasons (key, generated, viewed, shared count, release),
 * the seasons a preview can be generated for, and the selected season's Wrapped as WrappedPresenter shows it to the member (words in the
 * staff member's language), each card with its 1080 × 1920 PNG through the staff-only card route (MemberWrappedController::card).
 *
 * Atoms: the tab and the PNGs need `support.view` besides the record's `members.view` (Owner, Admin, Moderator, Support; the Analyst sees
 * no member activity); "Vorschau erzeugen" needs `support.reply` (Owner, Admin, Support). A Wrapped is the member's own activity (cities,
 * meets, scans), so the first view of a member's season per staff member and day is audited (`wrapped.viewed`, like ADM-62's
 * `spot.viewed`), with the season only. Photos leave as "present or not", never as a member media URL.
 */
final class MemberWrappedPanel
{
    public const VIEW_ATOM = 'support.view';

    public const GENERATE_ATOM = 'support.reply';

    public const VIEWED_EVENT = 'wrapped.viewed';

    /** How many years back the season picker offers besides the seasons the member already has. */
    private const YEARS_BACK = 2;

    /** Card fields that hold a member photo (WrappedMedia objects): shown as a flag only. */
    private const PHOTO_FIELDS = ['before_media', 'after_media', 'image'];

    /** Card fields the staff page never shows: the share card's QR as SVG markup (the PNG thumbnail draws it). */
    private const OMITTED_FIELDS = ['kind', 'qr_svg'];

    /**
     * @return array{seasons: list<array<string, mixed>>, options: list<string>, selected: string, preview: array<string, mixed>|null, can: array{generate: bool}}
     */
    public static function for(User $member, Staff $staff, mixed $requested): array
    {
        $releases = app(WrappedReleases::class);
        $rows = Wrapped::query()->where('user_id', $member->id)->get();
        $byKey = $rows->keyBy('season_key');

        $seasons = $rows->sort(self::order(...))->values()->map(fn (Wrapped $wrapped): array => [
            'key' => $wrapped->season_key,
            'generated_at' => $wrapped->generated_at->toIso8601String(),
            'viewed_at' => $wrapped->viewed_at?->toIso8601String(),
            'shared_count' => $wrapped->shared_count,
            'is_sample' => $wrapped->is_sample,
            'release_at' => $releases->releaseAt($wrapped->season_key)?->toIso8601String(),
            'released' => $releases->isReleased($wrapped->season_key),
        ])->all();

        $options = self::options(array_keys($byKey->all()));
        $selected = is_string($requested) && Season::tryFrom($requested) !== null ? $requested : ($seasons[0]['key'] ?? $options[0]);
        if (! in_array($selected, $options, true)) {
            $options[] = $selected;
            usort($options, fn (string $a, string $b): int => self::compareKeys($a, $b));
        }

        $wrapped = $byKey->get($selected);
        $preview = null;

        if ($wrapped instanceof Wrapped) {
            $wrapped->setRelation('user', $member);
            $preview = self::preview($member, $wrapped, $releases);
            self::auditView($member, $wrapped->season_key, $staff);
        }

        return [
            'seasons' => array_values($seasons),
            'options' => $options,
            'selected' => $selected,
            'preview' => $preview,
            'can' => ['generate' => $staff->can(self::GENERATE_ATOM)],
        ];
    }

    /** The first view of a member's season per staff member and day (06 §1 "every view of sensitive data"), the season only. */
    public static function auditView(User $member, string $seasonKey, Staff $staff): void
    {
        if (Cache::add("admin:wrapped-viewed:{$staff->getKey()}:{$member->id}:{$seasonKey}", true, now()->endOfDay())) {
            Audit::record(self::VIEWED_EVENT, $member, null, ['season_key' => $seasonKey], null, $staff);
        }
    }

    /**
     * @return array<string, mixed>
     */
    private static function preview(User $member, Wrapped $wrapped, WrappedReleases $releases): array
    {
        $presented = app(WrappedPresenter::class)->present($wrapped);
        $version = $wrapped->generated_at->getTimestamp();
        $cards = [];

        foreach ($presented['cards'] as $index => $card) {
            $n = $index + 1;
            $fields = [];

            foreach ($card as $key => $value) {
                if (in_array($key, self::OMITTED_FIELDS, true)) {
                    continue;
                }
                $fields[$key] = in_array($key, self::PHOTO_FIELDS, true) ? $value !== null : $value;
            }

            $cards[] = [
                'n' => $n,
                'kind' => (string) $card['kind'],
                'fields' => $fields,
                'image' => route('admin.members.wrapped.card', ['member' => $member->id, 'season' => $wrapped->season_key, 'n' => $n], false).'?v='.$version,
            ];
        }

        return [
            'season_key' => $wrapped->season_key,
            'window' => $presented['window'],
            'generated_at' => $wrapped->generated_at->toIso8601String(),
            'viewed_at' => $wrapped->viewed_at?->toIso8601String(),
            'shared_count' => $wrapped->shared_count,
            'is_sample' => $wrapped->is_sample,
            'opens' => $releases->opens($wrapped),
            'cards' => $cards,
        ];
    }

    /**
     * The picker: this year and YEARS_BACK before it (season and calendar year each) plus every season the member has, newest first.
     *
     * @param  list<string>  $existing
     * @return list<string>
     */
    private static function options(array $existing): array
    {
        $year = CarbonImmutable::now(config()->string('speedclub.wrapped.timezone'))->year;
        $keys = $existing;

        for ($y = $year; $y >= $year - self::YEARS_BACK; $y--) {
            $keys[] = "$y-saison";
            $keys[] = "$y-jahr";
        }

        $keys = array_values(array_unique(array_filter($keys, fn (string $key): bool => Season::tryFrom($key) !== null)));
        usort($keys, fn (string $a, string $b): int => self::compareKeys($a, $b));

        return $keys;
    }

    private static function order(Wrapped $a, Wrapped $b): int
    {
        return self::compareKeys($a->season_key, $b->season_key);
    }

    /** Year descending; within a year the season (March to October) before the calendar year, as the app's list (ListMyWrapped). */
    private static function compareKeys(string $a, string $b): int
    {
        $sa = Season::from($a);
        $sb = Season::from($b);

        return [$sb->year, $sa->kind === 'saison' ? 0 : 1] <=> [$sa->year, $sb->kind === 'saison' ? 0 : 1];
    }
}
