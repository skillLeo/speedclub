<?php

namespace App\Enums;

/**
 * M5.9d XP (m5.9d contract §1, 10 §16.4): the real actions that earn XP, each with its points in config `speedclub.xp.types`. Fixed
 * rules only: nothing for likes, reactions, posting volume or signing in. event_checkin (M5.6) and the forum types (M5.8) have their
 * hooks in App\Services\Progress\XpHooks and earn nothing until those features call them.
 */
enum XpType: string
{
    case FirstVehicle = 'first_vehicle';
    case DocumentedMod = 'documented_mod';
    case BuildUpdate = 'build_update';
    case NewSpot = 'new_spot';
    case SetCompleted = 'set_completed';
    case EventCheckin = 'event_checkin';
    case ForumSolution = 'forum_solution';
    case HelpfulReceived = 'helpful_received';

    public function points(): int
    {
        return max(0, config()->integer('speedclub.xp.types.'.$this->value.'.points', 0));
    }

    /**
     * The most XP this type may earn per member and Europe/Berlin day, null for none (only the overall daily cap).
     */
    public function dailyMax(): ?int
    {
        $max = config('speedclub.xp.types.'.$this->value.'.daily_max');

        return is_int($max) ? max(0, $max) : null;
    }
}
