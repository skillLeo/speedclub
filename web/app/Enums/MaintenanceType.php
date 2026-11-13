<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

/**
 * The maintenance items of a vehicle (09 §8.8, MNT-01): HU/AU (the month on the plakette, vehicles.hu_au_due), Service, Ölwechsel,
 * Bremsflüssigkeit (24 months), Reifenwechsel Sommer/Winter ("O bis O": due mid-October and two weeks after Easter, reminded early
 * October and around Easter), Kfz-Versicherung (Stichtag 30 November, reminded 1 November) and any number of custom items. Every type
 * but custom exists at most once per vehicle.
 */
enum MaintenanceType: string
{
    use HasLabel;

    case HuAu = 'hu_au';
    case Service = 'service';
    case OilChange = 'oil_change';
    case BrakeFluid = 'brake_fluid';
    case TyreChange = 'tyre_change';
    case Insurance = 'insurance';
    case Custom = 'custom';

    /**
     * How the next due date is found: from the last time and the interval, the HU/AU month, the two tyre seasons, or the yearly Stichtag.
     */
    public function schedule(): string
    {
        return match ($this) {
            self::HuAu => 'month',
            self::TyreChange => 'seasonal',
            self::Insurance => 'annual',
            self::Service, self::OilChange, self::BrakeFluid, self::Custom => 'interval',
        };
    }

    /** One per vehicle: every type but custom. */
    public function isSingleton(): bool
    {
        return $this !== self::Custom;
    }

    /**
     * Editor suggestions (MNT-02) when the member leaves the interval out. Only the brake fluid's 24 months and the HU/AU's 24 come from
     * the spec and the law (§ 29 StVZO, two years for cars); service and oil are common manufacturer values the member overrides.
     *
     * @return array{months: int|null, km: int|null}
     */
    public function defaultInterval(): array
    {
        return match ($this) {
            self::HuAu => ['months' => 24, 'km' => null],
            self::Service => ['months' => 24, 'km' => 30000],
            self::OilChange => ['months' => 12, 'km' => 15000],
            self::BrakeFluid => ['months' => 24, 'km' => null],
            self::TyreChange, self::Insurance, self::Custom => ['months' => null, 'km' => null],
        };
    }

    /**
     * Lead times in days before the due date when the member sets none (SET-23 gives the HU/AU its own, 30/14/1 by default).
     *
     * @return list<int>
     */
    public function defaultLeadDays(): array
    {
        return match ($this) {
            self::HuAu => [30, 14, 1],
            // Due 15 October and two weeks after Easter: the reminder lands on 1 October and on Easter Sunday.
            self::TyreChange => [14],
            // Stichtag 30 November, reminder 1 November.
            self::Insurance => [29],
            self::Service, self::OilChange, self::BrakeFluid, self::Custom => [14],
        };
    }

    /**
     * The SET-23 switch that silences this type's reminders (maintenance_prefs), or null for the HU/AU, which only its item switches off.
     */
    public function preference(): ?string
    {
        return match ($this) {
            self::HuAu => null,
            self::TyreChange => 'tyre_reminders',
            self::Insurance => 'insurance_reminder',
            self::Service, self::OilChange, self::BrakeFluid, self::Custom => 'service_reminders',
        };
    }
}
