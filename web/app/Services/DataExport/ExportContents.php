<?php

namespace App\Services\DataExport;

use App\Enums\DecisionAction;
use App\Models\InviteCode;
use App\Models\Media;
use App\Models\StickerDesign;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\Wrapped;
use App\Services\Auth\DeviceSessions;
use App\Services\Crews\CrewExport;
use App\Services\Dex\OwnerSpotStats;
use App\Services\Notifications\NotificationPrefs;
use App\Services\Progress\Levels;
use App\Services\Wrapped\WrappedPresenter;
use DateTimeInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What SET-12 hands over (GDPR Art. 15 and 20, m2.5-contract §3): the member's own data as JSON, other members by username only, never
 * an IP address (none is stored for members, ADR-113) and never a secret (password hash, two-factor key and codes, tokens). Photos
 * the member uploaded are listed in photos.json and copied as originals by the photo slices.
 *
 * The staff copy (SEC-P3-01: four-eyes members.export, data_exports.requested_by_staff_id set) leaves out what other members wrote or
 * sent: no message text, no chat photo, no reaction; per conversation only the partner, folder, dates and counts (like ADM-10's message
 * metadata). The member's own Art. 15 copy is SET-12's, never handed to staff.
 */
class ExportContents
{
    /** Morph names of what holds a chat photo (UploadMessagePhoto: the conversation, then the message). */
    private const CHAT_MEDIA = ['conversation', 'message'];

    /**
     * @return array<string, mixed> file name => JSON data, in the order of the ZIP
     */
    public function documents(User $user, bool $forStaff = false): array
    {
        return [
            'profile.json' => $this->profile($user),
            'settings.json' => $this->settings($user),
            'consents.json' => $this->consents($user),
            'vehicles.json' => $this->vehicles($user),
            'photos.json' => $this->photos($user, $forStaff),
            'follows.json' => $this->follows($user),
            'blocks.json' => $this->blocks($user),
            'saves.json' => $this->saves($user),
            'reports.json' => $this->reports($user),
            // M2.6: decisions about the member with their statements of reasons, and the member's own appeals; never who reported.
            'moderation_decisions.json' => $this->moderationDecisions($user),
            'appeals.json' => $this->appeals($user),
            'support_tickets.json' => $this->supportTickets($user, $forStaff),
            'devices.json' => $this->devices($user),
            // Fix round (review should-fix 10): the member's own security log, reactions, push installs and browser sessions.
            'security_events.json' => $this->securityEvents($user),
            'reactions.json' => $forStaff ? ['count' => $this->reactionCount($user)] : $this->reactions($user),
            'push_devices.json' => $this->pushDevices($user),
            // M4.15: the member web's browsers with Web Push (browser and dates; never the endpoint or its keys).
            'web_push_browsers.json' => $this->webPushBrowsers($user),
            'browser_sessions.json' => $this->browserSessions($user),
            // M4.7 (09 §8.4, §13): app installs with model, system and app version (never the install id or its hash).
            'device_installs.json' => $this->deviceInstalls($user),
            // M4.11 (09 §8.5, §8.6): the member's own build reactions, build follows, collections, comments and mentions written.
            'social.json' => $this->social($user),
            // M4.12 (09 §8.7, §13): events the member organised (with the exact place and the updates they wrote) and their answers.
            'events.json' => $this->events($user),
            // M4.13 (09 §8.8, §13): the member's maintenance items and service log with costs, odometers and the reminders sent.
            'maintenance.json' => $this->maintenance($user),
            // SEC-414-11 (M4.14, 09 §8.10): the business the member applied with or works for (application, Impressum, staff's reason
            // to the applicant), team invitations, and the portfolio tags the member asked for or decided.
            'business.json' => $this->business($user),
            'business_tags.json' => $this->businessTags($user),
            // M5.9b–e gifts (10 §16): the member's own spots and Dex progress (city and Bundesland only, never coordinates), what the
            // owner sees about the spots of their cars (DEX-06), XP, level, badges and founding number, invite codes, Car of the Day
            // features and Season Wrapped. Other members only as DEX-06 / INV-01 show them; never the install key (ADR-511).
            'spots.json' => $this->spots($user),
            'spots_of_my_cars.json' => $this->spotsOfMyCars($user, $forStaff),
            'progress.json' => $this->progress($user),
            'invites.json' => $this->invites($user),
            'car_of_the_day.json' => $this->carOfTheDay($user),
            // R4-2.1: the member's own Car of the Day votes (day, the car by its public id and name, cast and last changed). No counts.
            'car_of_the_day_votes.json' => $this->carOfTheDayVotes($user),
            'wrapped.json' => $this->wrapped($user),
            // M5.8 Forum: the member's own threads, posts (their text as written), "Hilfreich" votes and subscriptions; of other
            // members only the title of a thread the member wrote in, voted in or follows. Forum bans are in moderation_decisions.json.
            'forum.json' => $this->forum($user),
            // M5.7 (10 §6.1): the daily view totals of the member's profile and cars per source (their own statistics); never a view
            // event, a hash or anything about a viewer.
            'insights.json' => $this->insights($user),
            // R4-2.3 Crews: the member's crews with their role, open join requests, invitations received and sent (crew and username).
            'crews.json' => app(CrewExport::class)->forMember($user),
        ];
    }

    /**
     * M5.7: views per day and source of the profile and of each car (a car by its public id), oldest first.
     *
     * @return list<array{subject: string, vehicle: string|null, day: string, source: string, views: int}>
     */
    private function insights(User $user): array
    {
        return array_values(DB::table('view_days')
            ->leftJoin('vehicles', 'vehicles.id', '=', 'view_days.vehicle_id')
            ->where('view_days.owner_id', $user->getKey())
            ->orderBy('view_days.day')
            ->orderBy('view_days.id')
            ->get(['view_days.subject_type', 'vehicles.public_id', 'view_days.day', 'view_days.source', 'view_days.views'])
            ->map(fn (object $row): array => [
                'subject' => (string) $row->subject_type,
                'vehicle' => $row->public_id === null ? null : (string) $row->public_id,
                'day' => substr((string) $row->day, 0, 10),
                'source' => (string) $row->source,
                'views' => (int) $row->views,
            ])
            ->all());
    }

    /**
     * Spots the member made (removed ones too, marked), their Dex progress and First Spotter foils. A car by its public id, name and Dex
     * number; a place by city and Bundesland only.
     *
     * @return array{spots: list<array<string, mixed>>, dex: array{found: int, sets: list<array<string, mixed>>}, first_spotter_foils: int}
     */
    private function spots(User $user): array
    {
        $id = $user->getKey();
        $locale = $this->locale($user);
        $spots = DB::table('spots as s')
            ->leftJoin('vehicles as v', 'v.id', '=', 's.vehicle_id')
            ->leftJoin('makes as mk', 'mk.id', '=', 'v.make_id')
            ->leftJoin('vehicle_models as vm', 'vm.id', '=', 'v.model_id')
            ->leftJoin('generations as g', 'g.id', '=', 'v.generation_id')
            ->leftJoin('de_cities as c', 'c.id', '=', 's.city_id')
            ->where('s.spotter_id', $id)
            ->orderBy('s.created_at')
            ->orderBy('s.id')
            ->get(['v.public_id', 'v.dex_number', 'mk.name as make', 'vm.name as model', 'g.name as generation', 'c.name as city', 's.bundesland', 's.is_night', 's.is_first_three', 's.counted', 's.created_at', 's.deleted_at'])
            ->map(fn (object $spot): array => [
                'vehicle' => $spot->public_id,
                'vehicle_name' => self::carName($spot->make, $spot->model, $spot->generation),
                'dex_number' => $spot->dex_number === null ? null : (int) $spot->dex_number,
                'city' => $spot->city,
                'bundesland' => $spot->bundesland,
                'night' => (bool) $spot->is_night,
                'first_spotter' => (bool) $spot->is_first_three,
                'counted' => (bool) $spot->counted,
                'spotted_at' => $spot->created_at,
                'removed' => $spot->deleted_at !== null,
            ])
            ->all();

        $sets = DB::table('user_set_progress as p')
            ->leftJoin('dex_sets as d', 'd.key', '=', 'p.set_key')
            ->where('p.user_id', $id)
            ->orderBy('p.set_key')
            ->orderBy('p.period')
            ->get(['p.set_key', 'd.name_de', 'd.name_en', 'p.period', 'p.progress', 'p.target', 'p.completed_at'])
            ->map(fn (object $set): array => [
                'set' => $set->set_key,
                'name' => $locale === 'en' ? $set->name_en : $set->name_de,
                'period' => $set->period === '' ? null : $set->period,
                'progress' => (int) $set->progress,
                'target' => (int) $set->target,
                'completed_at' => $set->completed_at,
            ])
            ->all();

        $found = DB::table('spots')->where('spotter_id', $id)->where('counted', true)->whereNull('deleted_at')->distinct()->count('vehicle_id');

        return [
            'spots' => array_values($spots),
            'dex' => ['found' => $found, 'sets' => array_values($sets)],
            'first_spotter_foils' => DB::table('spots')->where('spotter_id', $id)->where('counted', true)->where('is_first_three', true)->whereNull('deleted_at')->count(),
        ];
    }

    /**
     * Per own car what DEX-06 shows the owner (OwnerSpotStats: totals, unique spotters, cities of day spots only and none while the car
     * hides them, the last 30 days, recent spotters by name only where their "Meine Spots zeigen" allows it, else anonymous) and the
     * car's STREET DEX switches. The staff copy has the number of recent spotters, not who.
     *
     * @return list<array<string, mixed>>
     */
    private function spotsOfMyCars(User $user, bool $forStaff): array
    {
        $rows = [];

        foreach (Vehicle::query()->where('owner_id', $user->getKey())->with(['make', 'vehicleModel', 'generation'])->orderBy('sort')->orderBy('id')->get() as $vehicle) {
            $stats = app(OwnerSpotStats::class)->for($vehicle);
            $spotters = array_map(fn (array $spotter): array => isset($spotter['username']) ? ['username' => $spotter['username'], 'display_name' => $spotter['display_name'] ?? null] : ['anonymous' => true], $stats['recent_spotters']);

            $rows[] = [
                'vehicle' => $vehicle->getAttribute('public_id'),
                'vehicle_name' => self::carName($vehicle->make?->getAttribute('name'), $vehicle->vehicleModel?->getAttribute('name'), $vehicle->generation?->getAttribute('name')),
                'dex_number' => $vehicle->getAttribute('dex_number'),
                'ghost_mode' => (bool) $vehicle->getAttribute('ghost_mode'),
                'spotting_paused' => (bool) $vehicle->getAttribute('spotting_paused'),
                'hide_spot_cities' => (bool) $vehicle->getAttribute('hide_spot_cities'),
                'total' => $stats['total'],
                'unique_spotters' => $stats['unique_spotters'],
                'cities_count' => $stats['cities_count'],
                'cities' => $stats['cities'],
                'last_30_days' => $stats['last_30_days'],
                'recent_spotters' => $forStaff ? ['count' => count($spotters)] : $spotters,
                'street_famous_tier' => $stats['street_famous']['tier'],
            ];
        }

        return $rows;
    }

    /**
     * XP events (type, points, capped, date; never the source's id), level and title, badges earned, the founding number.
     *
     * @return array<string, mixed>
     */
    private function progress(User $user): array
    {
        $locale = $this->locale($user);
        $level = app(Levels::class)->for((int) $user->getAttribute('xp'), $locale);
        $badges = DB::table('user_badges as ub')
            ->join('badges as b', 'b.key', '=', 'ub.badge_key')
            ->where('ub.user_id', $user->getKey())
            ->orderBy('ub.awarded_at')
            ->get(['ub.badge_key', 'b.name_de', 'b.name_en', 'b.tier', 'ub.awarded_at', 'ub.seen_at'])
            ->map(fn (object $badge): array => [
                'key' => $badge->badge_key,
                'name' => $locale === 'en' ? $badge->name_en : $badge->name_de,
                'tier' => $badge->tier,
                'awarded_at' => $badge->awarded_at,
                'seen_at' => $badge->seen_at,
            ])
            ->all();

        return [
            'xp' => $level['xp'],
            'level' => $level['level'],
            'title' => $level['title'],
            'founding_number' => $user->getAttribute('founding_number'),
            'activated_at' => $this->date($user->getAttribute('activated_at')),
            'xp_events' => DB::table('xp_events')->where('user_id', $user->getKey())->orderBy('created_at')->orderBy('id')
                ->get(['type', 'points', 'capped', 'day', 'created_at'])
                ->map(fn (object $event): array => ['type' => $event->type, 'points' => (int) $event->points, 'capped' => (bool) $event->capped, 'day' => $event->day, 'created_at' => $event->created_at])
                ->all(),
            'badges' => array_values($badges),
        ];
    }

    /**
     * The member's invite codes, and the code they joined with. The other side by username only while that member is public (verified,
     * active, a username, no block either way), otherwise "ein Mitglied".
     *
     * @return array{codes: list<array<string, mixed>>, joined_with: array{code: string, invited_by: string, accepted_at: string|null}|null}
     */
    private function invites(User $user): array
    {
        $locale = $this->locale($user);
        $name = function (?string $memberId) use ($user, $locale): ?string {
            if ($memberId === null) {
                return null;
            }

            $member = User::query()->find($memberId);

            return $member instanceof User && $member->hasUsername() && $member->isPubliclyVisible() && ! $user->hasBlockWith($member)
                ? '@'.$member->username
                : (string) __('settings.export.a_member', [], $locale);
        };

        $codes = InviteCode::query()->where('inviter_id', $user->getKey())->orderBy('created_at')->orderBy('code')->get()
            ->map(fn (InviteCode $invite): array => [
                'code' => $invite->code,
                'created_at' => $this->date($invite->created_at),
                'accepted_at' => $this->date($invite->accepted_at),
                'accepted_by' => $name($invite->accepted_by),
            ])
            ->all();
        $joined = InviteCode::query()->where('accepted_by', $user->getKey())->first();

        return [
            'codes' => array_values($codes),
            'joined_with' => $joined instanceof InviteCode ? ['code' => $joined->code, 'invited_by' => (string) $name($joined->inviter_id), 'accepted_at' => $this->date($joined->accepted_at)] : null,
        ];
    }

    /**
     * R4-2.1: the member's votes, oldest round first. The car by its public id and name, as the round showed it.
     *
     * @return list<array{day: string, vehicle: string|null, vehicle_name: string|null, voted_at: string|null, changed_at: string|null}>
     */
    private function carOfTheDayVotes(User $user): array
    {
        return array_values(DB::table('car_of_the_day_votes as cv')
            ->leftJoin('vehicles as v', 'v.id', '=', 'cv.vehicle_id')
            ->leftJoin('makes as mk', 'mk.id', '=', 'v.make_id')
            ->leftJoin('vehicle_models as vm', 'vm.id', '=', 'v.model_id')
            ->leftJoin('generations as g', 'g.id', '=', 'v.generation_id')
            ->where('cv.user_id', $user->getKey())
            ->orderBy('cv.day')
            ->get(['cv.day', 'v.public_id', 'mk.name as make', 'vm.name as model', 'g.name as generation', 'cv.created_at', 'cv.updated_at'])
            ->map(fn (object $row): array => [
                'day' => (string) $row->day,
                'vehicle' => $row->public_id === null ? null : (string) $row->public_id,
                'vehicle_name' => self::carName($row->make, $row->model, $row->generation),
                'voted_at' => $row->created_at === null ? null : (string) $row->created_at,
                'changed_at' => $row->updated_at === null ? null : (string) $row->updated_at,
            ])
            ->all());
    }

    /**
     * Days the member's cars were the Car of the Day (published picks only), with the story line and who chose (the job or the team).
     *
     * @return list<array<string, mixed>>
     */
    private function carOfTheDay(User $user): array
    {
        return array_values(DB::table('car_of_the_day as c')
            ->join('vehicles as v', 'v.id', '=', 'c.vehicle_id')
            ->leftJoin('makes as mk', 'mk.id', '=', 'v.make_id')
            ->leftJoin('vehicle_models as vm', 'vm.id', '=', 'v.model_id')
            ->leftJoin('generations as g', 'g.id', '=', 'v.generation_id')
            ->where('v.owner_id', $user->getKey())
            ->where('c.skipped', false)
            ->whereNotNull('c.published_at')
            ->orderBy('c.day')
            ->get(['c.day', 'v.public_id', 'mk.name as make', 'vm.name as model', 'g.name as generation', 'c.story_line', 'c.source'])
            ->map(fn (object $row): array => [
                'day' => $row->day,
                'vehicle' => $row->public_id,
                'vehicle_name' => self::carName($row->make, $row->model, $row->generation),
                'story_line' => $row->story_line,
                'source' => $row->source,
            ])
            ->all());
    }

    /**
     * The member's Season Wrapped, as the app presents them (WrappedPresenter: words, not ids), without photo links.
     *
     * @return list<array<string, mixed>>
     */
    private function wrapped(User $user): array
    {
        $previous = app()->getLocale();
        app()->setLocale($this->locale($user));

        try {
            return array_values(Wrapped::query()->where('user_id', $user->getKey())->with('user.avatar')->orderBy('season_key')->get()
                ->map(fn (Wrapped $wrapped): array => [
                    'season_key' => $wrapped->season_key,
                    'generated_at' => $this->date($wrapped->generated_at),
                    'viewed_at' => $this->date($wrapped->viewed_at),
                    'shared_count' => $wrapped->shared_count,
                    'payload' => self::withoutMedia(app(WrappedPresenter::class)->present($wrapped)),
                ])
                ->all());
        } finally {
            app()->setLocale($previous);
        }
    }

    /**
     * Drops photo objects (media, avatars, covers) from a presented payload: links that expire and say nothing beyond photos.json.
     *
     * @param  array<array-key, mixed>  $data
     * @return array<array-key, mixed>
     */
    private static function withoutMedia(array $data): array
    {
        $clean = [];

        foreach ($data as $key => $value) {
            if (is_string($key) && ($key === 'avatar' || $key === 'media' || $key === 'photo' || $key === 'cover' || str_ends_with($key, '_media'))) {
                continue;
            }

            $clean[$key] = is_array($value) ? self::withoutMedia($value) : $value;
        }

        return $clean;
    }

    private static function carName(mixed ...$parts): ?string
    {
        $name = trim(implode(' ', array_filter($parts, fn (mixed $part): bool => is_string($part) && $part !== '')));

        return $name === '' ? null : $name;
    }

    private function locale(User $user): string
    {
        return $user->getAttribute('locale') === 'en' ? 'en' : 'de';
    }

    /**
     * The member's business: as owner the whole application (Impressum, document note, status and the reason staff gave the applicant;
     * never a staff name), as staff the business's name and role; open team invitations to the member (business and date).
     *
     * @return array{membership: array<string, mixed>|null, invitations: array<int, array<string, mixed>>}
     */
    private function business(User $user): array
    {
        $id = $user->getKey();
        $membership = DB::table('business_members')->join('businesses', 'businesses.id', '=', 'business_members.business_id')
            ->where('business_members.user_id', $id)
            ->first(['businesses.id', 'businesses.slug', 'businesses.name', 'businesses.owner_id', 'business_members.role', 'business_members.created_at as joined_at']);
        $row = null;

        if ($membership !== null) {
            $row = ['business' => $membership->name, 'url' => '/b/'.$membership->slug, 'role' => $membership->role, 'joined_at' => $membership->joined_at];

            if ($membership->owner_id === $id) {
                $application = (array) DB::table('businesses')->where('id', $membership->id)->first([
                    'name', 'kind', 'legal_name', 'legal_form', 'representative', 'street', 'postcode', 'city', 'country', 'lat', 'lng', 'phone',
                    'email', 'website', 'register_court', 'register_number', 'vat_id', 'about', 'services', 'opening_hours', 'document_note', 'status',
                    'review_reason', 'submitted_at', 'verified_at', 'suspended_at', 'removed_at', 'created_at', 'updated_at',
                ]);

                foreach (['services', 'opening_hours'] as $json) {
                    $application[$json] = is_string($application[$json] ?? null) ? json_decode($application[$json], true) : null;
                }

                $row['application'] = $application;
                $row['team'] = DB::table('business_members')->join('users', 'users.id', '=', 'business_members.user_id')
                    ->where('business_members.business_id', $membership->id)->orderBy('business_members.created_at')
                    ->get(['users.username', 'business_members.role', 'business_members.created_at as joined_at'])
                    ->map(fn (object $member): array => (array) $member)->all();
            }
        }

        $invitations = DB::table('business_invites')->join('businesses', 'businesses.id', '=', 'business_invites.business_id')
            ->where('business_invites.user_id', $id)->orderBy('business_invites.created_at')
            ->get(['businesses.name as business', 'business_invites.created_at as invited_at'])
            ->map(fn (object $invite): array => (array) $invite)->all();

        return ['membership' => $row, 'invitations' => $invitations];
    }

    /**
     * "Eingebaut von" on the member's own mods (asked or decided by the member, or proposed to them), and the tags the member decided
     * for their business: the mod's title, the business, who asked first, the state and the dates.
     *
     * @return array{on_my_mods: array<int, array<string, mixed>>, decided_for_business: array<int, array<string, mixed>>}
     */
    private function businessTags(User $user): array
    {
        $id = $user->getKey();
        $columns = ['modifications.title as mod', 'businesses.name as business', 'mod_business_tags.status', 'mod_business_tags.initiated_by',
            'mod_business_tags.decided_at', 'mod_business_tags.created_at'];
        $base = fn () => DB::table('mod_business_tags')
            ->join('modifications', 'modifications.id', '=', 'mod_business_tags.mod_id')
            ->join('vehicles', 'vehicles.id', '=', 'modifications.vehicle_id')
            ->join('businesses', 'businesses.id', '=', 'mod_business_tags.business_id')
            ->orderBy('mod_business_tags.created_at');

        $mine = $base()->where('vehicles.owner_id', $id)->get($columns)->map(fn (object $tag): array => (array) $tag)->all();
        $decided = $base()->where('mod_business_tags.decided_by', $id)->where('vehicles.owner_id', '!=', $id)
            ->get(['businesses.name as business', 'mod_business_tags.status', 'mod_business_tags.decided_at'])->map(fn (object $tag): array => (array) $tag)->all();

        return ['on_my_mods' => $mine, 'decided_for_business' => $decided];
    }

    /**
     * Per vehicle (deleted ones still inside their grace period included): items, log entries (costs included: the member's own) and
     * photo references, the odometer; the reminder stages that went out.
     *
     * @return array{vehicles: list<array<string, mixed>>, reminders_sent: array<int, array<mixed>>}
     */
    private function maintenance(User $user): array
    {
        $vehicles = [];

        foreach (Vehicle::withTrashed()->where('owner_id', $user->getKey())->orderBy('sort')->orderBy('id')->get(['id', 'public_id', 'odometer_km', 'odometer_at']) as $vehicle) {
            $items = DB::table('maintenance_items')->where('vehicle_id', $vehicle->id)->orderBy('created_at')->get([
                'id', 'type', 'title', 'interval_months', 'interval_km', 'last_done_at', 'last_done_km', 'next_due_at', 'next_due_km', 'due_pinned',
                'lead_days', 'enabled', 'notes', 'created_at', 'updated_at',
            ])->map(function (object $item): array {
                $row = (array) $item;
                $row['lead_days'] = is_string($row['lead_days']) ? json_decode($row['lead_days'], true) : $row['lead_days'];

                return $row;
            })->all();
            $logs = DB::table('maintenance_logs')->where('vehicle_id', $vehicle->id)->orderBy('done_at')->get([
                'id', 'item_id', 'type', 'title', 'done_at', 'mileage_km', 'workshop', 'cost_cents', 'currency', 'notes', 'created_at', 'updated_at',
            ])->map(function (object $log): array {
                $row = (array) $log;
                $row['photos'] = Media::withTrashed()->where('mediable_type', 'maintenance_log')->where('mediable_id', $row['id'])->pluck('id')
                    ->map(fn (mixed $id): ?string => $this->photoRef($id))->filter()->values()->all();

                return $row;
            })->all();

            if ($items === [] && $logs === [] && $vehicle->getAttribute('odometer_km') === null) {
                continue;
            }

            $vehicles[] = [
                'vehicle' => $vehicle->public_id,
                'odometer_km' => $vehicle->getAttribute('odometer_km'),
                'odometer_at' => $this->date($vehicle->getAttribute('odometer_at')),
                'items' => $items,
                'logs' => $logs,
            ];
        }

        $sent = DB::table('maintenance_reminders')->where('user_id', $user->getKey())->whereNotNull('sent_at')->orderBy('sent_at')
            ->get(['reminder_key', 'due_on', 'due_km', 'lead_days', 'sent_at'])->map(fn (object $row): array => (array) $row)->all();

        return ['vehicles' => $vehicles, 'reminders_sent' => $sent];
    }

    /**
     * @return array{organised: list<array<string, mixed>>, answers: list<array<string, mixed>>, checkins: list<array<string, mixed>>, gallery_photos: list<array<string, mixed>>}
     */
    private function events(User $user): array
    {
        $id = $user->getKey();
        $organised = [];

        foreach (DB::table('events')->where('organiser_id', $id)->orderBy('created_at')->get([
            'id', 'slug', 'title', 'type', 'status', 'visibility', 'location_visibility', 'starts_at', 'ends_at', 'timezone', 'venue_name', 'street',
            'postcode', 'city', 'country', 'lat', 'lng', 'description', 'organiser_rules', 'rules', 'capacity', 'cancellation_reason', 'cancelled_at',
            'review_reason', 'submitted_at', 'published_at', 'created_at', 'updated_at',
        ]) as $event) {
            $row = (array) $event;
            $updates = [];

            foreach (DB::table('event_updates')->where('event_id', $row['id'])->orderBy('created_at')->get(['body', 'created_at']) as $update) {
                $updates[] = (array) $update;
            }

            unset($row['id']);
            $row['rules'] = is_string($row['rules']) ? json_decode($row['rules'], true) : $row['rules'];
            $row['url'] = '/e/'.(is_string($row['slug']) ? $row['slug'] : '');
            $row['updates'] = $updates;
            $organised[] = $row;
        }

        // Never another member's data: the event's title and link with the member's own answer.
        $answers = [];

        foreach (DB::table('event_rsvps')->join('events', 'events.id', '=', 'event_rsvps.event_id')->where('event_rsvps.user_id', $id)
            ->orderBy('event_rsvps.created_at')
            ->get(['events.title', 'events.slug', 'events.starts_at', 'event_rsvps.status', 'event_rsvps.status_at', 'event_rsvps.removed_at', 'event_rsvps.created_at']) as $answer) {
            $row = (array) $answer;
            $answers[] = [
                'event' => $row['title'],
                'url' => '/e/'.(is_string($row['slug']) ? $row['slug'] : ''),
                'starts_at' => $row['starts_at'],
                'status' => $row['status'],
                'since' => $row['status_at'],
                'removed_by_organiser_at' => $row['removed_at'],
                'answered_at' => $row['created_at'],
            ];
        }

        // M5.6 (review SF-6, Art. 15/20): the member's own check-ins and gallery uploads with the event's title and link, never another member.
        $checkins = [];

        foreach (DB::table('event_checkins')->join('events', 'events.id', '=', 'event_checkins.event_id')->where('event_checkins.user_id', $id)
            ->orderBy('event_checkins.checked_in_at')
            ->get(['events.title', 'events.slug', 'event_checkins.checked_in_at', 'event_checkins.profile_visible']) as $checkin) {
            $row = (array) $checkin;
            $checkins[] = [
                'event' => $row['title'],
                'url' => '/e/'.(is_string($row['slug']) ? $row['slug'] : ''),
                'checked_in_at' => $row['checked_in_at'],
                'shown_on_profile' => (bool) $row['profile_visible'],
            ];
        }

        $gallery = [];

        foreach (DB::table('event_photos')->join('events', 'events.id', '=', 'event_photos.event_id')->where('event_photos.uploader_id', $id)
            ->orderBy('event_photos.created_at')
            ->get(['events.title', 'events.slug', 'event_photos.media_id', 'event_photos.status', 'event_photos.reject_reason', 'event_photos.reviewed_at',
                'event_photos.created_at', 'event_photos.deleted_at']) as $photo) {
            $row = (array) $photo;
            $gallery[] = [
                'event' => $row['title'],
                'url' => '/e/'.(is_string($row['slug']) ? $row['slug'] : ''),
                'photo' => $this->photoRef($row['media_id']),
                'status' => $row['status'],
                'reject_reason' => $row['reject_reason'],
                'reviewed_at' => $row['reviewed_at'],
                'uploaded_at' => $row['created_at'],
                'deleted_at' => $row['deleted_at'],
            ];
        }

        return ['organised' => $organised, 'answers' => $answers, 'checkins' => $checkins, 'gallery_photos' => $gallery];
    }

    /**
     * @return array<string, array<int, array<string, mixed>>>
     */
    private function social(User $user): array
    {
        $id = $user->getKey();
        $rows = fn ($query): array => $query->get()->map(fn (object $row): array => (array) $row)->all();

        return [
            'reactions' => $rows(DB::table('reactions')->where('user_id', $id)->orderBy('created_at')->select(['reactable_type as item_type', 'reactable_id as item_id', 'type as reaction', 'updated_at as reacted_at'])),
            'followed_builds' => $rows(DB::table('vehicle_follows')->join('vehicles', 'vehicles.id', '=', 'vehicle_follows.vehicle_id')->where('vehicle_follows.user_id', $id)
                ->orderBy('vehicle_follows.created_at')->selectRaw("CONCAT('/v/', vehicles.slug, '-', vehicles.public_id) as vehicle, vehicle_follows.created_at as followed_at")),
            'collections' => DB::table('member_collections')->where('user_id', $id)->orderBy('position')->get(['id', 'name', 'is_default', 'created_at'])
                ->map(fn (object $collection): array => [
                    'name' => $collection->name ?? __('social.collections.default_name'),
                    'is_default' => (bool) $collection->is_default,
                    'created_at' => $collection->created_at,
                    'items' => $rows(DB::table('member_collection_items')->where('collection_id', $collection->id)->orderByDesc('position')->select(['item_type', 'item_id', 'created_at as added_at'])),
                ])->all(),
            // R5-5: a comment stands under an update (build_update_id) or on a car itself (vehicle_id).
            'comments' => $rows(DB::table('comments')->where('user_id', $id)->orderBy('created_at')->select(['build_update_id', 'vehicle_id', 'parent_id', 'body', 'status', 'created_at', 'deleted_at'])),
            'mentions_written' => $rows(DB::table('mentions')->join('users', 'users.id', '=', 'mentions.mentioned_user_id')->where('mentions.author_id', $id)
                ->orderBy('mentions.created_at')->select(['mentions.mentionable_type as item_type', 'mentions.mentionable_id as item_id', 'users.username as member', 'mentions.created_at'])),
        ];
    }

    /**
     * M5.8: threads the member started (every state, deleted ones within their retention marked), posts they wrote (opening posts and
     * replies, their text as they wrote it, Markdown), the replies they marked "Hilfreich" and the threads they follow. Another member
     * appears only as the title of a thread; never who else wrote, voted or follows.
     *
     * @return array{threads: list<array<string, mixed>>, posts: list<array<string, mixed>>, helpful_votes: list<array<string, mixed>>, subscriptions: list<array<string, mixed>>}
     */
    private function forum(User $user): array
    {
        $id = $user->getKey();
        $rows = fn ($query): array => array_values($query->get()->map(fn (object $row): array => (array) $row)->all());

        return [
            'threads' => array_values(DB::table('forum_threads')->join('forum_categories', 'forum_categories.id', '=', 'forum_threads.category_id')
                ->where('forum_threads.user_id', $id)->orderBy('forum_threads.created_at')
                ->get(['forum_threads.id', 'forum_threads.title', 'forum_categories.name_de as category', 'forum_threads.status', 'forum_threads.tags',
                    'forum_threads.review_reason', 'forum_threads.solved_post_id', 'forum_threads.created_at', 'forum_threads.published_at',
                    'forum_threads.edited_at', 'forum_threads.deleted_at'])
                ->map(fn (object $row): array => [
                    'id' => $row->id,
                    'title' => $row->title,
                    'category' => $row->category,
                    'status' => $row->status,
                    'tags' => is_string($row->tags) ? json_decode($row->tags, true) : [],
                    // Why the team did not publish it (pre-moderation), only on a rejected thread.
                    'review_reason' => $row->status === 'rejected' ? $row->review_reason : null,
                    'solved' => $row->solved_post_id !== null,
                    'created_at' => $row->created_at,
                    'published_at' => $row->published_at,
                    'edited_at' => $row->edited_at,
                    'deleted_at' => $row->deleted_at,
                ])->all()),
            'posts' => array_values(DB::table('forum_posts')->join('forum_threads', 'forum_threads.id', '=', 'forum_posts.thread_id')
                ->where('forum_posts.user_id', $id)->orderBy('forum_posts.created_at')
                ->get(['forum_posts.id', 'forum_posts.thread_id', 'forum_threads.title as thread_title', 'forum_posts.is_opening', 'forum_posts.parent_id',
                    'forum_posts.body', 'forum_posts.status', 'forum_posts.helpful_count', 'forum_threads.solved_post_id', 'forum_posts.created_at',
                    'forum_posts.edited_at', 'forum_posts.deleted_at'])
                ->map(fn (object $row): array => [
                    'id' => $row->id,
                    'thread_id' => $row->thread_id,
                    'thread_title' => $row->thread_title,
                    'kind' => (bool) $row->is_opening ? 'opening' : 'reply',
                    'answers_post_id' => $row->parent_id,
                    'text' => $row->body,
                    'status' => $row->status,
                    'helpful_count' => (int) $row->helpful_count,
                    'is_solution' => $row->solved_post_id === $row->id,
                    'created_at' => $row->created_at,
                    'edited_at' => $row->edited_at,
                    'deleted_at' => $row->deleted_at,
                ])->all()),
            'helpful_votes' => $rows(DB::table('forum_votes')->join('forum_posts', 'forum_posts.id', '=', 'forum_votes.post_id')
                ->join('forum_threads', 'forum_threads.id', '=', 'forum_posts.thread_id')
                ->where('forum_votes.user_id', $id)->orderBy('forum_votes.created_at')
                ->select(['forum_votes.post_id', 'forum_threads.title as thread_title', 'forum_votes.created_at as voted_at'])),
            'subscriptions' => $rows(DB::table('forum_subscriptions')->join('forum_threads', 'forum_threads.id', '=', 'forum_subscriptions.thread_id')
                ->where('forum_subscriptions.user_id', $id)->orderBy('forum_subscriptions.created_at')
                ->select(['forum_subscriptions.thread_id', 'forum_threads.title as thread_title', 'forum_subscriptions.created_at as subscribed_at'])),
        ];
    }

    /**
     * Every photo with an original still on the private disk, deleted ones inside their 30 days included: they are still held.
     *
     * @return Builder
     */
    public function photoQuery(User $user, bool $forStaff = false)
    {
        return DB::table('media')
            ->where('owner_id', $user->getKey())
            ->whereNotNull('original_path')
            // The staff copy has no chat photos (SEC-P3-01): they belong to a conversation.
            ->when($forStaff, fn ($query) => $query->where(fn ($kind) => $kind->whereNull('mediable_type')->orWhereNotIn('mediable_type', self::CHAT_MEDIA)))
            ->orderBy('id');
    }

    public static function photoFile(string $mediaId, ?string $originalPath): string
    {
        $extension = strtolower(pathinfo((string) $originalPath, PATHINFO_EXTENSION));

        return 'photos/'.$mediaId.'.'.($extension !== '' ? $extension : 'jpg');
    }

    /**
     * @return array<string, mixed>
     */
    private function profile(User $user): array
    {
        return [
            'id' => $user->id,
            'email' => $user->email,
            'email_verified_at' => $this->date($user->getAttribute('email_verified_at')),
            'username' => $user->username,
            'previous_username' => $user->getAttribute('previous_username'),
            'username_changed_at' => $this->date($user->getAttribute('username_changed_at')),
            'display_name' => $user->getAttribute('display_name'),
            'city' => $user->getAttribute('city'),
            'bio' => $user->getAttribute('bio'),
            'avatar' => $this->photoRef($user->getAttribute('avatar_media_id')),
            'cover' => $this->photoRef($user->getAttribute('cover_media_id')),
            'status' => $this->value($user->getAttribute('status')),
            'restrictions' => $user->getAttribute('restrictions'),
            'member_since' => $this->date($user->created_at),
            'last_seen_at' => $this->date($user->getAttribute('last_seen_at')),
            // Where sign-up began (ADR-216): qr, public_vehicle, public_profile or null.
            'signup_ref' => $user->getAttribute('signup_ref'),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function settings(User $user): array
    {
        $enum = fn (mixed $value): mixed => $value instanceof \BackedEnum ? $value->value : $value;

        return [
            'locale' => $user->getAttribute('locale'),
            'theme' => $enum($user->getAttribute('theme')),
            'power_display' => $enum($user->getAttribute('power_display')),
            'who_can_message' => $enum($user->getAttribute('who_can_message')),
            'discoverable' => $user->getAttribute('discoverable') !== false,
            'indexable' => $user->getAttribute('indexable') !== false,
            'show_owner_on_qr' => $user->getAttribute('show_owner_on_qr') !== false,
            'read_receipts' => $user->getAttribute('read_receipts') !== false,
            // M3.7 SET privacy "KI-Vorschläge".
            'ai_suggestions' => $user->getAttribute('ai_suggestions') === true,
            'notification_prefs' => NotificationPrefs::for($user),
            'two_factor_enabled' => $user->hasTwoFactor(),
            'two_factor_enabled_at' => $this->date($user->getAttribute('two_factor_confirmed_at')),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function consents(User $user): array
    {
        return [
            'terms_version' => $user->getAttribute('terms_version'),
            'privacy_version' => $user->getAttribute('privacy_version'),
            'consented_at' => $this->date($user->getAttribute('consented_at')),
            'age_16_confirmed' => $user->getAttribute('consented_at') !== null,
            'marketing_consent_at' => $this->date($user->getAttribute('marketing_consent_at')),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function vehicles(User $user): array
    {
        $vehicles = Vehicle::withTrashed()
            ->where('owner_id', $user->getKey())
            ->with(['make', 'vehicleModel', 'generation', 'specs', 'qrCodes', 'stickerDesigns'])
            ->orderBy('sort')
            ->orderBy('id')
            ->get();

        $rows = [];

        foreach ($vehicles as $vehicle) {
            $mods = DB::table('modifications')
                ->leftJoin('mod_categories', 'mod_categories.id', '=', 'modifications.category_id')
                ->leftJoin('brands', 'brands.id', '=', 'modifications.brand_id')
                ->where('modifications.vehicle_id', $vehicle->id)
                ->orderBy('modifications.sort')
                ->orderBy('modifications.id')
                ->get([
                    'modifications.id', 'mod_categories.key as category', 'modifications.title', 'brands.name as brand', 'modifications.brand_text',
                    'modifications.part_name', 'modifications.part_number', 'modifications.status', 'modifications.installed_on',
                    'modifications.cost_cents', 'modifications.cost_public', 'modifications.legal_status', 'modifications.notes',
                    // M5.3: the member's plans, budget included (their own data, GDPR Art. 15/20).
                    'modifications.target_month', 'modifications.priority', 'modifications.budget_cents', 'modifications.plan_sort',
                    'modifications.fields', 'modifications.created_at', 'modifications.updated_at', 'modifications.deleted_at',
                ])
                ->map(fn (object $mod): array => [...(array) $mod, 'fields' => is_string($mod->fields) ? json_decode($mod->fields, true) : null])
                ->all();

            $updates = DB::table('build_updates')
                ->where('vehicle_id', $vehicle->id)
                ->orderBy('created_at')
                ->orderBy('id')
                ->get(['id', 'type', 'payload', 'note', 'hidden', 'created_at'])
                ->map(fn (object $update): array => [...(array) $update, 'payload' => is_string($update->payload) ? json_decode($update->payload, true) : null, 'hidden' => (bool) $update->hidden])
                ->all();

            $specs = $vehicle->specs?->attributesToArray();
            unset($specs['vehicle_id']);

            $rows[] = [
                'id' => $vehicle->id,
                'public_id' => $vehicle->getAttribute('public_id'),
                'slug' => $vehicle->getAttribute('slug'),
                'status' => $this->value($vehicle->getAttribute('status')),
                'visibility' => $this->value($vehicle->getAttribute('visibility')),
                'is_main' => (bool) $vehicle->getAttribute('is_main'),
                'make' => $vehicle->make?->getAttribute('name') ?? $vehicle->getAttribute('make_text'),
                'model' => $vehicle->vehicleModel?->getAttribute('name') ?? $vehicle->getAttribute('model_text'),
                'generation' => $vehicle->generation?->getAttribute('name'),
                'model_year' => $vehicle->getAttribute('model_year'),
                'nickname' => $vehicle->getAttribute('nickname'),
                'description' => $vehicle->getAttribute('description'),
                'color' => $vehicle->getAttribute('color'),
                'hu_au_due' => $this->date($vehicle->getAttribute('hu_au_due')),
                // M5.7: the optional milestone goal ("Ziel: Saison 2027").
                'build_goal_season' => $vehicle->getAttribute('build_goal_season'),
                'cover' => $this->photoRef($vehicle->getAttribute('cover_media_id')),
                'specs' => $specs,
                'modifications' => $mods,
                'build_updates' => $updates,
                'qr_codes' => $vehicle->qrCodes->map(fn ($qr): array => [
                    'code' => $qr->getAttribute('code'),
                    'status' => $this->value($qr->getAttribute('status')),
                    'revoked_at' => $this->date($qr->getAttribute('revoked_at')),
                    'revoked_reason' => $this->value($qr->getAttribute('revoked_reason')),
                    'created_at' => $this->date($qr->getAttribute('created_at')),
                ])->all(),
                // M5.4: every version of the sticker design with its options (custom line included) and Scan-Test results.
                'sticker_designs' => $vehicle->stickerDesigns->sortBy('version')->values()->map(fn (StickerDesign $design): array => [
                    'reference' => $design->reference,
                    'version' => $design->version,
                    'template' => $design->template->value,
                    'options' => $design->options,
                    'scan_test' => $design->scan_test?->value,
                    'validated_at' => $this->date($design->validated_at),
                    'order_requested_at' => $this->date($design->order_requested_at),
                    'created_at' => $this->date($design->created_at),
                    'updated_at' => $this->date($design->updated_at),
                ])->all(),
                'published_at' => $this->date($vehicle->getAttribute('published_at')),
                'archived_at' => $this->date($vehicle->getAttribute('archived_at')),
                'created_at' => $this->date($vehicle->created_at),
                'updated_at' => $this->date($vehicle->updated_at),
                'deleted_at' => $this->date($vehicle->getAttribute('deleted_at')),
                // M5.9b/M5.9c: the Dex number and the Build Score with its parts and the days it changed.
                'dex_number' => $vehicle->getAttribute('dex_number'),
                'build_score' => $this->buildScore($vehicle->id),
            ];
        }

        return $rows;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function buildScore(string $vehicleId): ?array
    {
        $score = DB::table('build_scores')->where('vehicle_id', $vehicleId)->first();

        if ($score === null) {
            return null;
        }

        return [
            'total' => (int) $score->total,
            'stage' => (int) $score->stage,
            'parts' => ['completeness' => (int) $score->completeness, 'documentation' => (int) $score->documentation, 'community' => (int) $score->community, 'journey' => (int) $score->journey],
            'formula_version' => $score->formula_version,
            'computed_at' => $score->computed_at,
            'history' => DB::table('build_score_history')->where('vehicle_id', $vehicleId)->orderBy('day')->get(['day', 'total'])
                ->map(fn (object $day): array => ['day' => $day->day, 'total' => (int) $day->total])->all(),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function photos(User $user, bool $forStaff): array
    {
        return $this->photoQuery($user, $forStaff)
            ->get(['id', 'original_path', 'mediable_type', 'mediable_id', 'width', 'height', 'alt', 'category', 'sort', 'status', 'created_at', 'deleted_at'])
            ->map(fn (object $photo): array => [
                'file' => self::photoFile((string) $photo->id, is_string($photo->original_path) ? $photo->original_path : null),
                'id' => $photo->id,
                'attached_to' => $photo->mediable_type === null ? null : ['type' => $photo->mediable_type, 'id' => $photo->mediable_id],
                'width' => $photo->width,
                'height' => $photo->height,
                'alt' => $photo->alt,
                'category' => $photo->category,
                'sort' => $photo->sort,
                'status' => $photo->status,
                'created_at' => $photo->created_at,
                'deleted_at' => $photo->deleted_at,
            ])
            ->all();
    }

    /**
     * Usernames only (contract §3): a follower's profile is theirs, not part of this member's data.
     *
     * @return array{following: array<int, array{username: mixed, since: mixed}>, followers: array<int, array{username: mixed, since: mixed}>}
     */
    private function follows(User $user): array
    {
        $list = fn (string $mine, string $theirs): array => DB::table('follows')
            ->leftJoin('users', 'users.id', '=', 'follows.'.$theirs)
            ->where('follows.'.$mine, $user->getKey())
            ->orderBy('follows.created_at')
            ->get(['users.username', 'follows.created_at'])
            ->map(fn (object $row): array => ['username' => $row->username, 'since' => $row->created_at])
            ->all();

        return ['following' => $list('follower_id', 'followee_id'), 'followers' => $list('followee_id', 'follower_id')];
    }

    /**
     * @return array<int, array{username: mixed, blocked_at: mixed}>
     */
    private function blocks(User $user): array
    {
        return DB::table('blocks')
            ->where('blocker_id', $user->getKey())
            ->orderBy('created_at')
            ->get(['blocked_username', 'created_at'])
            ->map(fn (object $row): array => ['username' => $row->blocked_username, 'blocked_at' => $row->created_at])
            ->all();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function saves(User $user): array
    {
        return DB::table('saves')
            ->join('vehicles', 'vehicles.id', '=', 'saves.vehicle_id')
            ->leftJoin('users', 'users.id', '=', 'vehicles.owner_id')
            ->where('saves.user_id', $user->getKey())
            ->orderBy('saves.created_at')
            ->get(['vehicles.public_id', 'vehicles.slug', 'users.username as owner', 'saves.created_at'])
            ->map(fn (object $row): array => ['vehicle' => '/v/'.$row->slug.'-'.$row->public_id, 'owner' => $row->owner, 'saved_at' => $row->created_at])
            ->all();
    }

    /**
     * What the member can see in MSG-01/MSG-02: conversations not deleted for them, messages after their own "delete for me" point
     * and not hidden for them. The other side by username; a hard-deleted member is null ("Gelöschtes Mitglied" in the app).
     *
     * @return array<int, array<string, mixed>> a page of at most $limit conversations after $after, by id (keyset)
     */
    public function conversationsAfter(User $user, ?string $after, int $limit): array
    {
        if (! Schema::hasTable('conversation_participants')) {
            return [];
        }

        $mine = DB::table('conversation_participants')
            ->where('user_id', $user->getKey())
            ->whereNull('deleted_at')
            ->when($after !== null, fn ($query) => $query->where('conversation_id', '>', $after))
            ->orderBy('conversation_id')
            ->limit($limit)
            ->get(['conversation_id', 'folder', 'accepted_at', 'cleared_before_message_id', 'created_at']);

        $rows = [];

        foreach ($mine as $participant) {
            $others = DB::table('conversation_participants')
                ->leftJoin('users', 'users.id', '=', 'conversation_participants.user_id')
                ->where('conversation_participants.conversation_id', $participant->conversation_id)
                ->where('conversation_participants.user_id', '!=', $user->getKey())
                ->pluck('users.username')
                ->all();

            $messages = DB::table('messages')
                ->leftJoin('users', 'users.id', '=', 'messages.sender_id')
                ->where('messages.conversation_id', $participant->conversation_id)
                ->whereNull('messages.deleted_at')
                ->when(is_string($participant->cleared_before_message_id), fn ($query) => $query->where('messages.id', '>', $participant->cleared_before_message_id))
                ->whereNotExists(fn ($hidden) => $hidden->from('message_hidden')->whereColumn('message_hidden.message_id', 'messages.id')->where('message_hidden.user_id', $user->getKey()))
                ->orderBy('messages.id')
                ->get(['messages.id', 'messages.sender_id', 'users.username', 'messages.type', 'messages.body', 'messages.media_id', 'messages.created_at'])
                ->map(fn (object $message): array => [
                    'id' => $message->id,
                    'from' => $message->sender_id === $user->getKey() ? 'me' : $message->username,
                    'type' => $message->type,
                    'body' => $message->body,
                    'photo' => $message->media_id === null ? null : ($message->sender_id === $user->getKey() ? self::photoFile((string) $message->media_id, null) : 'not included: sent by the other member'),
                    'sent_at' => $message->created_at,
                ])
                ->all();

            $rows[] = [
                'id' => $participant->conversation_id,
                'with' => $others,
                'folder' => $participant->folder,
                'accepted_at' => $participant->accepted_at,
                'messages' => $messages,
            ];
        }

        return $rows;
    }

    /**
     * The staff copy of conversationsAfter() (SEC-P3-01): the same conversations, without a single message: partner, folder, dates and
     * counts only.
     *
     * @return array<int, array<string, mixed>>
     */
    public function conversationMetadataAfter(User $user, ?string $after, int $limit): array
    {
        if (! Schema::hasTable('conversation_participants')) {
            return [];
        }

        $mine = DB::table('conversation_participants')
            ->where('user_id', $user->getKey())
            ->whereNull('deleted_at')
            ->when($after !== null, fn ($query) => $query->where('conversation_id', '>', $after))
            ->orderBy('conversation_id')
            ->limit($limit)
            ->get(['conversation_id', 'folder', 'accepted_at', 'created_at']);

        $rows = [];

        foreach ($mine as $participant) {
            $messages = DB::table('messages')->where('conversation_id', $participant->conversation_id)->whereNull('deleted_at');

            $rows[] = [
                'id' => $participant->conversation_id,
                'with' => DB::table('conversation_participants')
                    ->leftJoin('users', 'users.id', '=', 'conversation_participants.user_id')
                    ->where('conversation_participants.conversation_id', $participant->conversation_id)
                    ->where('conversation_participants.user_id', '!=', $user->getKey())
                    ->pluck('users.username')
                    ->all(),
                'folder' => $participant->folder,
                'accepted_at' => $participant->accepted_at,
                'joined_at' => $participant->created_at,
                'messages' => (clone $messages)->count(),
                'messages_sent' => (clone $messages)->where('sender_id', $user->getKey())->count(),
                'first_message_at' => (clone $messages)->min('created_at'),
                'last_message_at' => (clone $messages)->max('created_at'),
            ];
        }

        return $rows;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function notificationsAfter(User $user, ?string $after, int $limit): array
    {
        return DB::table('notifications')
            ->where('notifiable_id', $user->getKey())
            ->when($after !== null, fn ($query) => $query->where('id', '>', $after))
            ->orderBy('id')
            ->limit($limit)
            ->get(['id', 'type', 'data', 'actor_count', 'read_at', 'created_at'])
            ->map(fn (object $row): array => [
                'id' => $row->id,
                'type' => $row->type,
                'details' => is_string($row->data) ? json_decode($row->data, true) : null,
                'actor_count' => $row->actor_count,
                'read_at' => $row->read_at,
                'created_at' => $row->created_at,
            ])
            ->all();
    }

    /**
     * Reports this member filed (M2.6). Read defensively: the table belongs to the safety module.
     *
     * @return array<int, array<string, mixed>>
     */
    private function reports(User $user): array
    {
        if (! Schema::hasTable('reports') || ! Schema::hasColumn('reports', 'reporter_id')) {
            return [];
        }

        $columns = array_values(array_filter(
            ['target_type', 'target_id', 'reason', 'sub_reason', 'details', 'created_at'],
            fn (string $column): bool => Schema::hasColumn('reports', $column),
        ));

        return DB::table('reports')
            ->where('reporter_id', $user->getKey())
            ->orderBy('created_at')
            ->get($columns)
            ->map(fn (object $row): array => (array) $row)
            ->all();
    }

    /**
     * Decisions that restricted this member (M2.6, Art. 17 DSA): what, when, the restriction and the full statement of reasons. Nothing
     * about the reports behind them or who filed them.
     *
     * @return list<array<string, mixed>>
     */
    private function moderationDecisions(User $user): array
    {
        return array_values(DB::table('decisions')
            ->join('moderation_cases', 'moderation_cases.id', '=', 'decisions.case_id')
            ->where('decisions.subject_id', $user->getKey())
            ->where('decisions.action', '!=', DecisionAction::NoAction->value)
            ->orderBy('decisions.decided_at')
            ->get(['decisions.id', 'moderation_cases.target_type', 'decisions.action', 'decisions.restriction', 'decisions.statement_of_reasons', 'decisions.decided_at', 'decisions.notified_at'])
            ->map(fn (object $row): array => [
                'id' => $row->id,
                'target_type' => $row->target_type,
                'action' => $row->action,
                'restriction' => is_string($row->restriction) ? json_decode($row->restriction, true) : null,
                'statement_of_reasons' => is_string($row->statement_of_reasons) ? json_decode($row->statement_of_reasons, true) : null,
                'decided_at' => $row->decided_at,
                'notified_at' => $row->notified_at,
            ])
            ->all());
    }

    /**
     * Appeals this member filed, with their own text.
     *
     * @return list<array<string, mixed>>
     */
    private function appeals(User $user): array
    {
        return array_values(DB::table('appeals')
            ->where('appellant_id', $user->getKey())
            ->orderBy('created_at')
            ->get(['decision_id', 'role', 'text', 'status', 'created_at', 'decided_at'])
            ->map(fn (object $row): array => (array) $row)
            ->all());
    }

    /**
     * The member's tickets with the thread they read in SET-15 (member, guest and team replies).
     *
     * @return array<int, array<string, mixed>>
     */
    private function supportTickets(User $user, bool $forStaff): array
    {
        $tickets = DB::table('support_tickets')->where('user_id', $user->getKey())->orderBy('created_at')->get(['id', 'category', 'subject', 'status', 'created_at', 'closed_at']);

        return $tickets->map(fn (object $ticket): array => [
            ...(array) $ticket,
            'messages' => DB::table('ticket_messages')
                ->where('ticket_id', $ticket->id)
                // SEC-P3-12: the team's internal notes never reach the member (ADR-240 f); the four-eyes staff copy keeps them.
                ->when(! $forStaff, fn ($query) => $query->where('internal', false))
                ->orderBy('created_at')
                ->get(['author_type', 'body', 'created_at'])
                ->map(fn (object $message): array => (array) $message)
                ->all(),
        ])->all();
    }

    /**
     * SET-06's list: device names and dates, no IP and no place (none is stored).
     *
     * @return array<int, array<string, mixed>>
     */
    private function devices(User $user): array
    {
        return DB::table('personal_access_tokens')
            ->where('tokenable_type', $user->getMorphClass())
            ->where('tokenable_id', $user->getKey())
            ->orderBy('created_at')
            ->get(['device_name', 'name', 'platform', 'app_version', 'created_at', 'last_used_at', 'expires_at'])
            ->map(fn (object $row): array => [
                'device_name' => $row->device_name ?? $row->name,
                'platform' => $row->platform,
                'app_version' => $row->app_version,
                'signed_in_at' => $row->created_at,
                'last_used_at' => $row->last_used_at,
                'expires_at' => $row->expires_at,
            ])
            ->all();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function deviceInstalls(User $user): array
    {
        return DB::table('device_installs')
            ->where('user_id', $user->getKey())
            ->orderBy('first_seen_at')
            ->get(['platform', 'model', 'os_version', 'app_version', 'approx_city', 'first_seen_at', 'last_seen_at'])
            ->map(fn (object $row): array => (array) $row)
            ->all();
    }

    /**
     * The member's own security log (05 §13): what happened and when, with the device name where one was recorded. Never an IP (none is
     * stored for members, ADR-113) and never the hash chain.
     *
     * @return array<int, array<string, mixed>>
     */
    private function securityEvents(User $user): array
    {
        return DB::table('audit_events')
            ->where('target_type', $user->getMorphClass())
            ->where('target_id', $user->getKey())
            ->where('action', 'like', 'member.%')
            ->orderBy('id')
            ->get(['action', 'occurred_at', 'after'])
            ->map(function (object $row): array {
                $after = is_string($row->after) ? json_decode($row->after, true) : null;
                $device = is_array($after) && is_string($after['device_name'] ?? null) ? $after['device_name'] : null;

                return ['action' => $row->action, 'at' => $row->occurred_at, 'device_name' => $device];
            })
            ->all();
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function reactions(User $user): array
    {
        if (! Schema::hasTable('message_reactions')) {
            return [];
        }

        return DB::table('message_reactions')
            ->where('user_id', $user->getKey())
            ->orderBy('created_at')
            ->get(['message_id', 'reaction', 'created_at'])
            ->map(fn (object $row): array => (array) $row)
            ->all();
    }

    private function reactionCount(User $user): int
    {
        return Schema::hasTable('message_reactions') ? DB::table('message_reactions')->where('user_id', $user->getKey())->count() : 0;
    }

    /**
     * Installs that get push notices. The token itself is left out: it is an address for Expo, not the member's data.
     *
     * @return array<int, array<string, mixed>>
     */
    private function pushDevices(User $user): array
    {
        return DB::table('push_tokens')
            ->where('user_id', $user->getKey())
            ->orderBy('created_at')
            ->get(['platform', 'created_at', 'last_used_at'])
            ->map(fn (object $row): array => (array) $row)
            ->all();
    }

    /**
     * Browsers that get Web Push. The endpoint and its keys are left out: they are addresses for the push services.
     *
     * @return array<int, array<string, mixed>>
     */
    private function webPushBrowsers(User $user): array
    {
        if (! Schema::hasTable('push_subscriptions')) {
            return [];
        }

        return DB::table('push_subscriptions')
            ->where('user_id', $user->getKey())
            ->orderBy('created_at')
            ->get(['browser', 'created_at', 'last_used_at'])
            ->map(fn (object $row): array => (array) $row)
            ->all();
    }

    /**
     * Browser sign-ins of SET-06, as browser and system ("Chrome auf macOS"), with the last use. No IP is stored (should-fix 9).
     *
     * @return array<int, array<string, mixed>>
     */
    private function browserSessions(User $user): array
    {
        if (! Schema::hasTable(config()->string('session.table'))) {
            return [];
        }

        return DB::table(config()->string('session.table'))
            ->where('user_id', $user->getKey())
            ->orderBy('last_activity')
            ->get(['user_agent', 'last_activity'])
            ->map(fn (object $row): array => [
                'browser' => DeviceSessions::browserName(is_string($row->user_agent) ? $row->user_agent : ''),
                'last_used_at' => date(DATE_ATOM, (int) $row->last_activity),
            ])
            ->all();
    }

    private function photoRef(mixed $mediaId): ?string
    {
        if (! is_string($mediaId)) {
            return null;
        }

        $path = Media::withTrashed()->whereKey($mediaId)->value('original_path');

        return is_string($path) ? self::photoFile($mediaId, $path) : null;
    }

    private function date(mixed $value): ?string
    {
        return $value instanceof DateTimeInterface ? $value->format(DATE_ATOM) : (is_string($value) ? $value : null);
    }

    private function value(mixed $value): mixed
    {
        return $value instanceof \BackedEnum ? $value->value : $value;
    }
}
