<?php

namespace Database\Seeders;

use App\Enums\BadgeCategory;
use App\Enums\BadgeTier;
use App\Models\Badge;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;

/**
 * M5.9d badges at launch (m5.9d contract §2, owner gift detail M5.9d) plus the two M5.7 milestones (10 §6.4): 33 badges in the nine categories, 7 of them hidden ("???" and a
 * hint until earned), bronze/silver/gold. Fixed rules only (App\Services\Badges\BadgeRules): never likes, reactions, followers, posting
 * volume, sign-ins, speed or racing. Safe in production and safe to run again: an existing badge is never changed, so the admin badge
 * manager's edits survive. Treffen (M5.6 check-ins) and Forum (M5.8) badges start inactive until those features exist; staff switch
 * them on in the badge manager.
 */
class BadgeSeeder extends Seeder
{
    use SeedsFromData;

    public function run(): void
    {
        $created = 0;

        foreach (self::definitions() as $sort => $badge) {
            $row = Badge::query()->firstOrCreate(['key' => $badge['key']], [...$badge, 'sort' => ($sort + 1) * 10]);
            $created += $row->wasRecentlyCreated ? 1 : 0;
        }

        $this->say("Badges: {$created} new.");
    }

    /**
     * @return list<array{key: string, name_de: string, name_en: string, description_de: string, description_en: string, hint_de: string|null, hint_en: string|null, rule_json: array<string, mixed>, hidden: bool, tier: BadgeTier, category: BadgeCategory, active: bool}>
     */
    public static function definitions(): array
    {
        $badge = fn (string $key, BadgeCategory $category, BadgeTier $tier, array $rule, array $de, array $en, bool $hidden = false, bool $active = true): array => [
            'key' => $key,
            'name_de' => $de[0],
            'name_en' => $en[0],
            'description_de' => $de[1],
            'description_en' => $en[1],
            'hint_de' => $hidden ? $de[2] : null,
            'hint_en' => $hidden ? $en[2] : null,
            'rule_json' => $rule,
            'hidden' => $hidden,
            'tier' => $tier,
            'category' => $category,
            'active' => $active,
        ];
        $garage = BadgeCategory::Garage;
        $mods = BadgeCategory::Mods;
        $spotting = BadgeCategory::Spotting;
        [$bronze, $silver, $gold] = [BadgeTier::Bronze, BadgeTier::Silver, BadgeTier::Gold];

        return [
            // Garage
            $badge('erster-build', $garage, $bronze, ['metric' => 'published_vehicles', 'gte' => 1],
                ['Erster Build', 'Du hast dein erstes Auto in der Garage veröffentlicht.'],
                ['First build', 'You published your first car in the garage.']),
            $badge('volle-garage', $garage, $silver, ['metric' => 'published_vehicles', 'gte' => 3],
                ['Volle Garage', 'Drei Autos stehen veröffentlicht in deiner Garage.'],
                ['Full garage', 'Three published cars stand in your garage.']),
            $badge('build-score-400', $garage, $bronze, ['metric' => 'build_score', 'gte' => 400],
                ['Gut dokumentiert', 'Einer deiner Builds hat einen Build Score von 400.'],
                ['Well documented', 'One of your builds has a Build Score of 400.']),
            $badge('build-score-600', $garage, $silver, ['metric' => 'build_score', 'gte' => 600],
                ['Sauber dokumentiert', 'Einer deiner Builds hat einen Build Score von 600.'],
                ['Cleanly documented', 'One of your builds has a Build Score of 600.']),
            $badge('build-score-800', $garage, $gold, ['metric' => 'build_score', 'gte' => 800],
                ['Build-Archiv', 'Einer deiner Builds hat einen Build Score von 800.'],
                ['Build archive', 'One of your builds has a Build Score of 800.']),
            // M5.7 (10 §6.4): a quiet milestone, the threshold only.
            $badge('100-aufrufe', $garage, $bronze, ['metric' => 'views_received', 'gte' => 100],
                ['100 Aufrufe', 'Deine Builds und dein Profil wurden 100-mal angesehen.'],
                ['100 views', 'Your builds and profile were viewed 100 times.']),
            $badge('wartungsbuch', $garage, $bronze, ['metric' => 'maintenance_logs', 'gte' => 10],
                ['Wartungsbuch', 'Du hast zehn Wartungen eingetragen.', 'Führ Buch über das, was dein Auto am Laufen hält.'],
                ['Service log', 'You logged ten services.', 'Keep a record of what keeps your car running.'], hidden: true),

            // Mods
            $badge('erster-mod', $mods, $bronze, ['metric' => 'documented_mods', 'gte' => 1],
                ['Erster Mod', 'Du hast einen Mod mit Marke, Einbaudatum und Foto dokumentiert.'],
                ['First mod', 'You documented a mod with brand, install date and photo.']),
            $badge('zehn-mods', $mods, $silver, ['metric' => 'documented_mods', 'gte' => 10],
                ['Schrauberliste', 'Zehn Mods mit Marke, Einbaudatum und Foto.'],
                ['Wrench list', 'Ten mods with brand, install date and photo.']),
            $badge('mod-archiv', $mods, $gold, ['metric' => 'documented_mods', 'gte' => 25],
                ['Mod-Archiv', '25 Mods mit Marke, Einbaudatum und Foto.'],
                ['Mod archive', '25 mods with brand, install date and photo.']),
            $badge('allrounder', $mods, $silver, ['metric' => 'mod_categories', 'gte' => 5],
                ['Allrounder', 'Deine dokumentierten Mods decken fünf Bereiche ab.', 'Nicht nur Felgen: Schraub mal woanders.'],
                ['All-rounder', 'Your documented mods cover five areas.', 'Not just wheels: try another part of the car.'], hidden: true),

            // Spotting
            $badge('erster-spot', $spotting, $bronze, ['metric' => 'cars_spotted', 'gte' => 1],
                ['Erster Spot', 'Du hast dein erstes Auto gespottet.'],
                ['First spot', 'You spotted your first car.']),
            $badge('spotter-25', $spotting, $silver, ['metric' => 'cars_spotted', 'gte' => 25],
                ['Spotter', '25 verschiedene Autos in deinem Dex.'],
                ['Spotter', '25 different cars in your Dex.']),
            $badge('spotter-100', $spotting, $gold, ['metric' => 'cars_spotted', 'gte' => 100],
                ['Dex-Sammler', '100 verschiedene Autos in deinem Dex.'],
                ['Dex collector', '100 different cars in your Dex.']),
            $badge('unterwegs', $spotting, $silver, ['metric' => 'cities_spotted', 'gte' => 10],
                ['Unterwegs', 'Du hast in zehn Städten gespottet.'],
                ['On the road', 'You spotted cars in ten cities.']),
            $badge('street-famous-10', $spotting, $bronze, ['metric' => 'unique_spotters_of_my_cars', 'gte' => 10],
                ['Street Famous', 'Zehn Leute haben eines deiner Autos gespottet.'],
                ['Street Famous', 'Ten people spotted one of your cars.']),
            $badge('street-famous-50', $spotting, $silver, ['metric' => 'unique_spotters_of_my_cars', 'gte' => 50],
                ['Street Famous 50', '50 Leute haben eines deiner Autos gespottet.'],
                ['Street Famous 50', '50 people spotted one of your cars.']),
            $badge('street-famous-100', $spotting, $gold, ['metric' => 'unique_spotters_of_my_cars', 'gte' => 100],
                ['Street Famous 100', '100 Leute haben eines deiner Autos gespottet.'],
                ['Street Famous 100', '100 people spotted one of your cars.']),
            $badge('street-famous-500', $spotting, $gold, ['metric' => 'unique_spotters_of_my_cars', 'gte' => 500],
                ['Stadtgespräch', '500 Leute haben eines deiner Autos gespottet.', 'Manche Autos kennt die halbe Stadt.'],
                ['Talk of the town', '500 people spotted one of your cars.', 'Half the town knows some cars.'], hidden: true),
            $badge('erstentdecker', $spotting, $silver, ['metric' => 'first_spotter_foils', 'gte' => 10],
                ['Erstentdecker', 'Zehnmal unter den ersten drei, die ein Auto gespottet haben.', 'Sei früh dran, wenn ein Sticker neu ist.'],
                ['First finder', 'Ten times among the first three to spot a car.', 'Be early when a sticker is new.'], hidden: true),

            // Sets
            $badge('erstes-set', BadgeCategory::Sets, $bronze, ['metric' => 'sets_completed', 'gte' => 1],
                ['Erstes Set', 'Du hast ein Dex-Set komplett.'],
                ['First set', 'You completed a Dex set.']),
            $badge('set-sammler', BadgeCategory::Sets, $silver, ['metric' => 'sets_completed', 'gte' => 5],
                ['Set-Sammler', 'Fünf Dex-Sets komplett.'],
                ['Set collector', 'Five Dex sets completed.']),
            $badge('jdm-legenden', BadgeCategory::Sets, $gold, ['metric' => 'set_completed', 'set' => 'jdm-legends', 'eq' => true],
                ['JDM-Legenden', 'Du hast jede JDM-Legende im Dex.', 'Ein ganz bestimmtes Set, Generation für Generation.'],
                ['JDM legends', 'Every JDM legend is in your Dex.', 'One particular set, generation by generation.'], hidden: true),

            // Treffen (M5.6 check-ins: inactive until then)
            $badge('erstes-treffen', BadgeCategory::Treffen, $bronze, ['metric' => 'events_attended', 'gte' => 1],
                ['Erstes Treffen', 'Du hast bei einem Treffen eingecheckt.'],
                ['First meet', 'You checked in at a meet.'], active: false),
            $badge('treffen-stammgast', BadgeCategory::Treffen, $silver, ['metric' => 'events_attended', 'gte' => 5],
                ['Treffen-Stammgast', 'Bei fünf Treffen eingecheckt.'],
                ['Meet regular', 'Checked in at five meets.'], active: false),

            // Forum (M5.8: inactive until then)
            $badge('erste-loesung', BadgeCategory::Forum, $bronze, ['metric' => 'forum_solutions', 'gte' => 1],
                ['Erste Lösung', 'Eine deiner Antworten im Forum wurde als Lösung markiert.'],
                ['First solution', 'One of your forum answers was marked as the solution.'], active: false),
            $badge('forum-helfer', BadgeCategory::Forum, $silver, ['metric' => 'forum_solutions', 'gte' => 10],
                ['Forum-Helfer', 'Zehn deiner Antworten wurden als Lösung markiert.'],
                ['Forum helper', 'Ten of your answers were marked as the solution.'], active: false),
            // M5.7 (10 §6.4 "Hilfreich im Forum (10×)"): inactive like the other forum badges until staff switch them on.
            $badge('hilfreich-10', BadgeCategory::Forum, $silver, ['metric' => 'helpful_received', 'gte' => 10],
                ['Hilfreich', 'Deine Forum-Antworten wurden zehnmal als hilfreich markiert.'],
                ['Helpful', 'Your forum answers were marked helpful ten times.'], active: false),

            // Sticker
            $badge('sticker-drauf', BadgeCategory::Sticker, $bronze, ['metric' => 'sticker_active', 'eq' => true],
                ['Sticker drauf', 'Dein Auto hat einen aktiven Speedclub Sticker.'],
                ['Sticker on', 'Your car has an active Speedclub sticker.']),
            $badge('sticker-100', BadgeCategory::Sticker, $silver, ['metric' => 'sticker_scans', 'gte' => 100],
                ['Oft gescannt', 'Deine Sticker wurden 100-mal gescannt.', 'Park da, wo Leute stehen bleiben.'],
                ['Often scanned', 'Your stickers were scanned 100 times.', 'Park where people stop and look.'], hidden: true),

            // Founding
            $badge('founding-member', BadgeCategory::Founding, $gold, ['metric' => 'founding_member', 'eq' => true],
                ['Founding Member', 'Du bist eines der ersten 1.000 Mitglieder von Speedclub.'],
                ['Founding Member', 'You are one of the first 1,000 members of Speedclub.']),

            // Community
            $badge('crew-starter', BadgeCategory::Community, $bronze, ['metric' => 'invites_accepted', 'gte' => 1],
                ['Crew Starter', 'Über eine Einladung dazugekommen oder jemanden eingeladen, der jetzt dabei ist.'],
                ['Crew Starter', 'Joined through an invite, or invited someone who is in now.']),
            $badge('ein-jahr-dabei', BadgeCategory::Community, $silver, ['metric' => 'member_days', 'gte' => 365],
                ['Ein Jahr dabei', 'Seit einem Jahr Mitglied bei Speedclub.', 'Gute Dinge brauchen Zeit.'],
                ['One year in', 'A member of Speedclub for a year.', 'Good things take time.'], hidden: true),
        ];
    }
}
