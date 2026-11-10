<?php

namespace App\Services\Admin;

use App\Models\ModerationCase;
use App\Models\QrCode;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Support\Codes;
use App\Support\EmailAddress;
use App\Support\Slug;
use Illuminate\Support\Str;
use Throwable;

/**
 * ADM-07 global search and the ⌘K palette (06_ADMIN_SPEC §3 Overview). Groups in a fixed order, each only with its atom, at most five
 * hits each, groups without a hit left out:
 *
 * - members (members.view): username prefix; an exact e-mail address only with members.view_pii, so nobody without it can test
 *   whether an address has an account;
 * - vehicles (vehicles.view): the slug (resolved by its public id, as the public page does) or the public id itself;
 * - qr (qr.view): the sticker code;
 * - cases (moderation.view): the case id.
 *
 * Input is trimmed and cut at 120 characters. No hit carries an e-mail address; url is left to the admin, which knows its routes.
 */
final class Search
{
    public const MAX_QUERY = 120;

    private const PER_GROUP = 5;

    /**
     * @return list<array{group: 'members'|'vehicles'|'qr'|'cases', items: list<array{id: string, title: string, subtitle: string|null, url: string|null}>}>
     */
    public function search(Staff $staff, string $q): array
    {
        $q = Str::limit(trim($q), self::MAX_QUERY, '');

        if (mb_strlen($q) < 2) {
            return [];
        }

        $groups = [
            'members' => $staff->can('members.view') ? $this->members($staff, $q) : [],
            'vehicles' => $staff->can('vehicles.view') ? $this->vehicles($q) : [],
            'qr' => $staff->can('qr.view') ? $this->qr($q) : [],
            'cases' => $staff->can('moderation.view') ? $this->cases($q) : [],
        ];

        $result = [];

        foreach ($groups as $group => $items) {
            if ($items !== []) {
                $result[] = ['group' => $group, 'items' => $items];
            }
        }

        return $result;
    }

    /**
     * @return list<array{id: string, title: string, subtitle: string|null, url: string|null}>
     */
    private function members(Staff $staff, string $q): array
    {
        $query = User::query()->whereNull('deleted_at');

        if (str_contains($q, '@') && ! str_starts_with($q, '@')) {
            if (! $staff->can('members.view_pii')) {
                return [];
            }

            try {
                $email = EmailAddress::normalize($q);
            } catch (Throwable) {
                return [];
            }

            $query->where('email', $email);
        } else {
            $prefix = mb_strtolower(ltrim($q, '@'));

            if ($prefix === '') {
                return [];
            }

            $query->where('username', 'like', self::escapeLike($prefix).'%')->orderBy('username');
        }

        return array_values($query->limit(self::PER_GROUP)->get(['id', 'username', 'display_name'])
            ->map(fn (User $user): array => [
                'id' => $user->id,
                'title' => $user->username === null ? '—' : '@'.$user->username,
                'subtitle' => $user->display_name,
                'url' => null,
            ])->all());
    }

    /**
     * @return list<array{id: string, title: string, subtitle: string|null, url: string|null}>
     */
    private function vehicles(string $q): array
    {
        // A slug resolves by its public id, as the public page does; a bare public id is a slug without text.
        $publicId = Slug::publicId($q);

        if ($publicId === null) {
            return [];
        }

        return array_values(Vehicle::query()
            ->with(['owner:id,username', 'make:id,name', 'vehicleModel:id,name'])
            ->whereNull('deleted_at')
            ->where('public_id', $publicId)
            ->limit(self::PER_GROUP)
            ->get()
            ->map(fn (Vehicle $vehicle): array => [
                'id' => $vehicle->id,
                'title' => trim(($vehicle->make->name ?? $vehicle->getAttribute('make_text') ?? '').' '.($vehicle->vehicleModel->name ?? $vehicle->getAttribute('model_text') ?? '')) ?: $vehicle->public_id,
                'subtitle' => $vehicle->owner?->username === null ? null : '@'.$vehicle->owner->username,
                'url' => null,
            ])->all());
    }

    /**
     * @return list<array{id: string, title: string, subtitle: string|null, url: string|null}>
     */
    private function qr(string $q): array
    {
        $code = Codes::normalize($q);

        if ($code === null) {
            return [];
        }

        return array_values(QrCode::query()->where('code', $code)->limit(self::PER_GROUP)->get(['id', 'code', 'status', 'vehicle_id'])
            ->map(fn (QrCode $qr): array => [
                'id' => $qr->id,
                'title' => $qr->code,
                'subtitle' => $qr->status->value,
                'url' => null,
            ])->all());
    }

    /**
     * @return list<array{id: string, title: string, subtitle: string|null, url: string|null}>
     */
    private function cases(string $q): array
    {
        if (preg_match('/\A[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}\z/', $q) !== 1) {
            return [];
        }

        return array_values(ModerationCase::query()->whereKey(strtolower($q))->limit(self::PER_GROUP)->get(['id', 'status', 'target_type'])
            ->map(fn (ModerationCase $case): array => [
                'id' => $case->id,
                'title' => $case->id,
                'subtitle' => $case->status->value.' · '.$case->target_type->value,
                'url' => null,
            ])->all());
    }

    private static function escapeLike(string $value): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $value);
    }
}
