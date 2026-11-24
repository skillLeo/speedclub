<?php

namespace App\Enums;

/**
 * M5.9d badge rule engine (m5.9d contract §2): the whitelisted metrics a badge rule may name. Each is one fixed query in
 * App\Services\Badges\BadgeMetrics; there is no free SQL and nothing is evaluated. Never likes, reactions, followers, posting volume or
 * sign-ins (10 §16 hard rules), and never the hour of a spot (ADR-516 b: a night-spot count would send people through residential streets
 * at night, when cars stand at their owners' homes; `night_spots` was removed and a stored rule naming it no longer validates).
 */
enum BadgeMetric: string
{
    /** Published, not deleted cars. */
    case PublishedVehicles = 'published_vehicles';
    /** Mods documented as for the Build Score (BuildScoreInputs): not planned, brand, installation date and a usable photo. */
    case DocumentedMods = 'documented_mods';
    /** Different mod categories among the documented mods. */
    case ModCategories = 'mod_categories';
    /** The highest Build Score total among the member's published cars. */
    case BuildScore = 'build_score';
    /** Maintenance log entries of the member's cars. */
    case MaintenanceLogs = 'maintenance_logs';
    /** Different cars the member spotted (counted, not removed). */
    case CarsSpotted = 'cars_spotted';
    /** Different cities of the member's counted day spots. */
    case CitiesSpotted = 'cities_spotted';
    /** Counted spots that carried the "First Spotter" foil. */
    case FirstSpotterFoils = 'first_spotter_foils';
    /** Street Famous: the most unique spotters one of the member's cars has. */
    case UniqueSpottersOfMyCars = 'unique_spotters_of_my_cars';
    /** Completed STREET DEX sets (any period). */
    case SetsCompleted = 'sets_completed';
    /** One named set completed (`set`: its key). */
    case SetCompleted = 'set_completed';
    /** Event check-ins (M5.6 hook, read from the XP ledger). */
    case EventsAttended = 'events_attended';
    /** Forum answers marked as the solution (M5.8 hook, read from the XP ledger). */
    case ForumSolutions = 'forum_solutions';
    /** An active QR sticker on one of the member's cars. */
    case StickerActive = 'sticker_active';
    /** Scans of the member's stickers in total. */
    case StickerScans = 'sticker_scans';
    /** A Founding Member number. */
    case FoundingMember = 'founding_member';
    /** Redeemed invites, both sides: codes of the member others redeemed, plus the code the member signed up with. */
    case InvitesAccepted = 'invites_accepted';
    /** Days since the account was activated (membership, never sign-ins). */
    case MemberDays = 'member_days';
    /** The member's level. */
    case Level = 'level';
    /**
     * M5.7 (10 §6.4 "100 Aufrufe"): counted views of the member's profile and cars, all time (view_days). A threshold only; the number
     * is never shown to anybody else.
     */
    case ViewsReceived = 'views_received';
    /** M5.7 (10 §6.4 "Hilfreich im Forum (10×)"): "Hilfreich" votes on the member's published forum posts (forum_votes). */
    case HelpfulReceived = 'helpful_received';

    /**
     * Metrics answered yes or no: a rule compares them with `eq: true` only.
     */
    public function isBoolean(): bool
    {
        return in_array($this, [self::SetCompleted, self::StickerActive, self::FoundingMember], true);
    }

    /**
     * The extra parameter a rule must name for this metric, or null.
     */
    public function parameter(): ?string
    {
        return $this === self::SetCompleted ? 'set' : null;
    }
}
