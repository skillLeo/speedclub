<?php

namespace App\Services\Dex;

use App\Enums\Bundesland;
use App\Models\DeCity;
use App\Models\User;
use App\Support\Slug;

/**
 * Turns what a client sends about a place into a de_cities row (m5.9b contract §2): the city id the app picked on the device, else a
 * name matched by its normalised form (umlauts spelled out, case and punctuation ignored), narrowed by the Bundesland when one is given;
 * the largest place of that name wins. No match is no city: free text is never stored.
 */
final class CityMatcher
{
    public function byId(int $id): ?DeCity
    {
        return DeCity::query()->find($id);
    }

    public function byName(string $name, ?Bundesland $bundesland = null): ?DeCity
    {
        // "Düsseldorf, Nordrhein-Westfalen" from a place search: the city is the first part.
        $first = trim(explode(',', $name)[0]);
        $slug = Slug::make($first);

        if ($slug === '') {
            return null;
        }

        $match = DeCity::query()
            ->where(fn ($query) => $query->where('slug', $slug)->orWhere('ascii_name', $first))
            ->when($bundesland !== null, fn ($query) => $query->where('bundesland', $bundesland?->value))
            ->orderByDesc('population')
            ->orderBy('id')
            ->first();

        return $match;
    }

    /**
     * users.bundesland: from the public profile city only, when it names a known city; null otherwise (CR-P5G-08 / SEC-P5G-04). The
     * Bundesland shows publicly on Build Score rank lines ("#2 in Bayern"), so the private SET-11 region is never read for it, and a
     * member without a public city has no Bundesland and no Bundesland rank. One rule for every use (ranks, the Wrapped percentile and
     * the Car of the Day rotation).
     */
    public function bundeslandFor(User $user): ?Bundesland
    {
        $place = $user->getAttribute('city');

        return is_string($place) && trim($place) !== '' ? $this->byName($place)?->bundesland : null;
    }
}
