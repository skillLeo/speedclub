<?php

namespace App\Services\Badges;

use App\Enums\BadgeMetric;
use App\Enums\ForumPostStatus;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\ModStatus;
use App\Enums\QrStatus;
use App\Enums\VehicleStatus;
use App\Enums\XpType;
use App\Services\Progress\Levels;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The whitelisted metrics of the badge rules (BadgeMetric), each one fixed query that answers rows of (user_id, value), grouped per
 * member. Plain SQL for MySQL 8 and MariaDB 10.6+ (joins, EXISTS, COUNT/MAX/SUM, CASE). Narrowed to a list of members before grouping
 * (the nightly chunk, one member's check), or over everybody for the admin preview.
 *
 * "Documented mod" is the Build Score's rule (BuildScoreInputs::isDocumented): not planned, a brand, an installation date and a usable
 * photo. Nothing reads likes, reactions, followers, posts or sign-ins. M5.7 adds the views received (a threshold, view_days) and the
 * forum's "Hilfreich" votes received (10 §6.4).
 */
final class BadgeMetrics
{
    /**
     * Values for the members in $userIds (every member when null); members without a row have the value 0.
     *
     * @param  list<string>|null  $userIds
     */
    public function query(BadgeMetric $metric, ?string $set, ?array $userIds): Builder
    {
        $only = fn (Builder $query, string $column): Builder => $userIds === null ? $query : $query->whereIn($column, $userIds);

        return match ($metric) {
            BadgeMetric::PublishedVehicles => $only($this->cars('v'), 'v.owner_id')
                ->where('v.status', VehicleStatus::Published->value)
                ->groupBy('v.owner_id')
                ->selectRaw('v.owner_id as user_id, COUNT(*) as value'),
            BadgeMetric::DocumentedMods => $only($this->documentedMods(), 'v.owner_id')
                ->groupBy('v.owner_id')
                ->selectRaw('v.owner_id as user_id, COUNT(*) as value'),
            BadgeMetric::ModCategories => $only($this->documentedMods(), 'v.owner_id')
                ->groupBy('v.owner_id')
                ->selectRaw('v.owner_id as user_id, COUNT(DISTINCT m.category_id) as value'),
            BadgeMetric::BuildScore => $only($this->cars('v'), 'v.owner_id')
                ->join('build_scores as bs', 'bs.vehicle_id', '=', 'v.id')
                ->where('v.status', VehicleStatus::Published->value)
                ->groupBy('v.owner_id')
                ->selectRaw('v.owner_id as user_id, MAX(bs.total) as value'),
            BadgeMetric::MaintenanceLogs => $only($this->cars('v'), 'v.owner_id')
                ->join('maintenance_logs as ml', 'ml.vehicle_id', '=', 'v.id')
                ->groupBy('v.owner_id')
                ->selectRaw('v.owner_id as user_id, COUNT(*) as value'),
            BadgeMetric::CarsSpotted => $only($this->spots(), 's.spotter_id')
                ->groupBy('s.spotter_id')
                ->selectRaw('s.spotter_id as user_id, COUNT(DISTINCT s.vehicle_id) as value'),
            BadgeMetric::CitiesSpotted => $only($this->spots(), 's.spotter_id')
                ->where('s.is_night', false)
                ->whereNotNull('s.city_id')
                ->groupBy('s.spotter_id')
                ->selectRaw('s.spotter_id as user_id, COUNT(DISTINCT s.city_id) as value'),
            BadgeMetric::FirstSpotterFoils => $only($this->spots(), 's.spotter_id')
                ->where('s.is_first_three', true)
                ->groupBy('s.spotter_id')
                ->selectRaw('s.spotter_id as user_id, COUNT(*) as value'),
            BadgeMetric::UniqueSpottersOfMyCars => $only($this->cars('v'), 'v.owner_id')
                ->join('vehicle_spot_stats as st', 'st.vehicle_id', '=', 'v.id')
                ->groupBy('v.owner_id')
                ->selectRaw('v.owner_id as user_id, MAX(st.unique_spotters) as value'),
            BadgeMetric::SetsCompleted => $only(DB::table('user_set_progress', 'p'), 'p.user_id')
                ->whereNotNull('p.completed_at')
                ->groupBy('p.user_id')
                ->selectRaw('p.user_id as user_id, COUNT(*) as value'),
            BadgeMetric::SetCompleted => $only(DB::table('user_set_progress', 'p'), 'p.user_id')
                ->whereNotNull('p.completed_at')
                ->where('p.set_key', (string) $set)
                ->groupBy('p.user_id')
                ->selectRaw('p.user_id as user_id, COUNT(*) as value'),
            BadgeMetric::EventsAttended => $this->ledger(XpType::EventCheckin, $only),
            BadgeMetric::ForumSolutions => $this->ledger(XpType::ForumSolution, $only),
            BadgeMetric::StickerActive => $only($this->cars('v'), 'v.owner_id')
                ->join('qr_codes as q', 'q.vehicle_id', '=', 'v.id')
                ->where('q.status', QrStatus::Active->value)
                ->groupBy('v.owner_id')
                ->selectRaw('v.owner_id as user_id, COUNT(*) as value'),
            BadgeMetric::StickerScans => $only($this->cars('v'), 'v.owner_id')
                ->join('qr_codes as q', 'q.vehicle_id', '=', 'v.id')
                ->join('qr_scan_daily as d', 'd.qr_code_id', '=', 'q.id')
                ->groupBy('v.owner_id')
                ->selectRaw('v.owner_id as user_id, SUM(d.count) as value'),
            BadgeMetric::FoundingMember => $only(DB::table('users', 'u'), 'u.id')
                ->whereNotNull('u.founding_number')
                ->selectRaw('u.id as user_id, 1 as value'),
            BadgeMetric::InvitesAccepted => DB::query()
                ->fromSub(
                    // The inviter's side counts redeemed codes by accepted_at: a hard-deleted invitee nulls accepted_by (CR-P5G-10).
                    $only(DB::table('invite_codes', 'i'), 'i.inviter_id')->whereNotNull('i.accepted_at')->selectRaw('i.inviter_id as user_id')
                        ->unionAll($only(DB::table('invite_codes', 'j'), 'j.accepted_by')->whereNotNull('j.accepted_by')->selectRaw('j.accepted_by as user_id')),
                    'x',
                )
                ->groupBy('x.user_id')
                ->selectRaw('x.user_id as user_id, COUNT(*) as value'),
            BadgeMetric::MemberDays => $only(DB::table('users', 'u'), 'u.id')
                ->whereNotNull('u.activated_at')
                ->selectRaw('u.id as user_id, TIMESTAMPDIFF(DAY, u.activated_at, ?) as value', [CarbonImmutable::now()->utc()->format('Y-m-d H:i:s')]),
            BadgeMetric::Level => $only(DB::table('users', 'u'), 'u.id')
                ->select('u.id as user_id')
                ->selectSub(self::levelQuery(), 'value'),
            BadgeMetric::ViewsReceived => $only(DB::table('view_days', 'vd'), 'vd.owner_id')
                ->groupBy('vd.owner_id')
                ->selectRaw('vd.owner_id as user_id, SUM(vd.views) as value'),
            // Votes on published, not deleted posts (not samples); a member cannot vote for their own post (M5.8).
            BadgeMetric::HelpfulReceived => $only(DB::table('forum_votes', 'fv'), 'fp.user_id')
                ->join('forum_posts as fp', 'fp.id', '=', 'fv.post_id')
                ->where('fp.status', ForumPostStatus::Published->value)
                ->whereNull('fp.deleted_at')
                ->where('fp.is_sample', false)
                ->whereColumn('fv.user_id', '!=', 'fp.user_id')
                ->groupBy('fp.user_id')
                ->selectRaw('fp.user_id as user_id, COUNT(*) as value'),
        };
    }

    /**
     * @param  list<string>  $userIds
     * @return array<string, int> user id => value (members without a row are left out: their value is 0)
     */
    public function values(BadgeMetric $metric, ?string $set, array $userIds): array
    {
        if ($userIds === []) {
            return [];
        }

        $values = [];

        foreach ($this->query($metric, $set, $userIds)->get() as $row) {
            $values[(string) $row->user_id] = (int) $row->value;
        }

        return $values;
    }

    /**
     * Not deleted cars of not deleted members (the member column is v.owner_id).
     */
    private function cars(string $alias): Builder
    {
        return DB::table('vehicles', $alias)->whereNull($alias.'.deleted_at');
    }

    private function documentedMods(): Builder
    {
        return $this->cars('v')
            ->join('modifications as m', 'm.vehicle_id', '=', 'v.id')
            ->whereNull('m.deleted_at')
            ->where('m.status', '!=', ModStatus::Planned->value)
            ->whereNotNull('m.installed_on')
            ->where(fn (Builder $brand) => $brand->whereNotNull('m.brand_id')->orWhere(fn (Builder $text) => $text->whereNotNull('m.brand_text')->whereRaw("TRIM(m.brand_text) <> ''")))
            ->whereExists(fn (Builder $photo) => $photo->selectRaw('1')->from('media', 'md')
                ->where('md.mediable_type', 'modification')
                ->whereColumn('md.mediable_id', 'm.id')
                ->whereNull('md.deleted_at')
                ->where('md.status', MediaStatus::Ready->value)
                ->where('md.moderation_status', '!=', ModerationStatus::Rejected->value));
    }

    /**
     * Counted, not removed spots (the member column is s.spotter_id). Never a sample car or a sample owner's car for a real spotter
     * (CR-P5G-07, "samples never earn"; such spots are stored uncounted since the fix, this also covers older rows). A sample spotter
     * (the staging demo) keeps its sample spots.
     */
    private function spots(): Builder
    {
        return DB::table('spots', 's')->where('s.counted', true)->whereNull('s.deleted_at')
            ->where(fn (Builder $real) => $real
                ->whereNotExists(fn (Builder $sample) => $sample->selectRaw('1')->from('vehicles', 'sv')
                    ->join('users as so', 'so.id', '=', 'sv.owner_id')
                    ->whereColumn('sv.id', 's.vehicle_id')
                    ->where(fn (Builder $either) => $either->where('sv.is_sample', true)->orWhere('so.is_sample', true)))
                ->orWhereExists(fn (Builder $spotter) => $spotter->selectRaw('1')->from('users', 'ss')
                    ->whereColumn('ss.id', 's.spotter_id')->where('ss.is_sample', true)));
    }

    /**
     * @param  callable(Builder, string): Builder  $only
     */
    private function ledger(XpType $type, callable $only): Builder
    {
        return $only(DB::table('xp_events', 'x'), 'x.user_id')
            ->where('x.type', $type->value)
            ->groupBy('x.user_id')
            ->selectRaw('x.user_id as user_id, COUNT(*) as value');
    }

    /**
     * The level of u.xp: how many level thresholds (above level 1) it reached, plus one. Bound values only.
     */
    private static function levelQuery(): Builder
    {
        $thresholds = array_values(array_filter(Levels::thresholds(), fn (int $from, int $level): bool => $level > 1, ARRAY_FILTER_USE_BOTH));
        $query = DB::query()->selectRaw('1 as level_reached');

        foreach ($thresholds as $from) {
            $query->unionAll(DB::query()->selectRaw('? as level_reached', [$from]));
        }

        return DB::query()->fromSub($query, 'lv')->selectRaw('COUNT(*)')->where(fn (Builder $reached) => $reached->where('lv.level_reached', '=', 1)->orWhereColumn('lv.level_reached', '<=', 'u.xp'));
    }
}
