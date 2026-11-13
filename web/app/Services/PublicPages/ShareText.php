<?php

namespace App\Services\PublicPages;

use App\Enums\PowerDisplay;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;

/**
 * The meta description of a shared page (meta description, og:description, twitter:description): specific and built from what the
 * page shows, at most MAX characters, in the page's language. "500 PS · 540 Nm · 12 Mods: KW V3, Rays Volk Racing TE37 Saga …
 * Sieh dir den kompletten Build an." The owner's own text, after the figures, only when it says something (MEANINGFUL_*). Never
 * anything the page hides: no plate, no VIN, no location, no cost.
 */
final class ShareText
{
    public const MAX = 155;

    /** Below this the owner's text is a placeholder ("Mein Auto"), and the generated line says more. */
    private const MEANINGFUL_CHARACTERS = 60;

    private const MEANINGFUL_WORDS = 8;

    public function __construct(private readonly VehiclePresenter $presenter) {}

    /**
     * @param  array<string, mixed>  $data  PublicVehicleResource, resolved
     */
    public function vehicle(Vehicle $vehicle, array $data, string $title, string $locale): string
    {
        $parts = $this->specParts($vehicle, $locale);
        $mods = $this->installedMods($data);

        if ($mods !== []) {
            $parts[] = trans_choice('public.vehicle.meta_mods', count($mods), ['count' => count($mods)], $locale);
        }

        // The owner's words after the figures, when they say something.
        $own = $this->meaningful($data['description'] ?? null);

        if ($own !== null) {
            return $this->clip($parts === [] ? $own : implode(' · ', $parts).' – '.$own);
        }

        $cta = (string) __('public.vehicle.meta_cta', [], $locale);

        if ($parts === []) {
            return $this->clip(__('public.vehicle.meta_description', ['title' => $title], $locale).' '.$cta);
        }

        return $this->compose(implode(' · ', $parts), $mods, $cta);
    }

    /**
     * @param  array<string, mixed>  $data  MemberProfileResource, resolved
     * @param  list<string>  $builds  the titles of the public builds, in the order the page lists them
     */
    public function member(array $data, string $name, array $builds, string $locale): string
    {
        $city = is_string($data['city'] ?? null) && trim($data['city']) !== '' ? trim($data['city']) : null;
        $lead = $city === null ? $name : (string) __('public.member.meta_from', ['name' => $name, 'city' => $city], $locale);
        $own = $this->meaningful($data['bio'] ?? null);

        if ($own !== null) {
            $count = $builds === [] ? '' : ' · '.trans_choice('public.member.meta_builds', count($builds), ['count' => count($builds)], $locale);

            return $this->clip($lead.$count.' – '.$own);
        }

        if ($builds === []) {
            return $this->clip(__('public.member.meta_description', ['name' => $lead], $locale));
        }

        $prefix = $lead.' · '.trans_choice('public.member.meta_builds', count($builds), ['count' => count($builds)], $locale);

        return $this->compose($prefix, $builds, (string) __('public.member.meta_cta', [], $locale));
    }

    /**
     * "{prefix}: A, B, C. {cta}" with as many items as fit, "… {cta}" when some did not; without any item that fits "{prefix}. {cta}".
     *
     * @param  list<string>  $items
     */
    private function compose(string $prefix, array $items, string $cta): string
    {
        $listed = [];

        foreach ($items as $index => $item) {
            $all = $index === count($items) - 1;
            $candidate = $prefix.': '.implode(', ', [...$listed, $item]).($all ? '. ' : ' … ').$cta;

            if (mb_strlen($candidate) > self::MAX) {
                break;
            }

            $listed[] = $item;
        }

        if ($listed === []) {
            return $this->clip($prefix.'. '.$cta);
        }

        return $prefix.': '.implode(', ', $listed).(count($listed) === count($items) ? '. ' : ' … ').$cta;
    }

    /**
     * "500 PS", "540 Nm"; without either the year and the drivetrain. Units in PS as the cards: the page's own setting is the viewer's.
     *
     * @return list<string>
     */
    private function specParts(Vehicle $vehicle, string $locale): array
    {
        $strip = [];

        foreach ($this->presenter->specStrip($vehicle, PowerDisplay::PsKw, $locale) as $entry) {
            if ($entry['value'] !== null) {
                $strip[$entry['key']] = $entry;
            }
        }

        $parts = [];

        foreach (['power', 'torque'] as $key) {
            if (isset($strip[$key])) {
                $parts[] = $strip[$key]['value']."\u{00A0}".$strip[$key]['unit'];
            }
        }

        if ($parts === []) {
            if (isset($strip['model_year'])) {
                $parts[] = (string) __('public.vehicle.meta_year', ['year' => $strip['model_year']['value']], $locale);
            }

            if (isset($strip['drivetrain'])) {
                $parts[] = (string) $strip['drivetrain']['value'];
            }
        }

        return $parts;
    }

    /**
     * The installed mods, highlights first, each once: "KW V3", or "Brand Title" when the title does not name the brand.
     *
     * @param  array<string, mixed>  $data
     * @return list<string>
     */
    private function installedMods(array $data): array
    {
        $rows = is_array($data['highlights'] ?? null) ? $data['highlights'] : [];

        foreach (is_array($data['mods']['groups'] ?? null) ? $data['mods']['groups'] : [] as $group) {
            foreach (is_array($group['items'] ?? null) ? $group['items'] : [] as $item) {
                $rows[] = $item;
            }
        }

        $mods = [];

        foreach ($rows as $row) {
            if (! is_array($row) || ($row['status'] ?? null) !== 'installed' || ! is_string($row['title'] ?? null) || trim($row['title']) === '') {
                continue;
            }

            $title = trim($row['title']);
            $brand = is_string($row['brand'] ?? null) ? trim($row['brand']) : '';
            $mods[(string) ($row['id'] ?? $title)] = $brand !== '' && ! str_starts_with(mb_strtolower($title), mb_strtolower($brand)) ? $brand.' '.$title : $title;
        }

        return array_values($mods);
    }

    private function meaningful(mixed $text): ?string
    {
        // The whole text: clip() cuts the line it ends up in.
        if (! is_string($text)) {
            return null;
        }

        $plain = trim((string) preg_replace('/\s+/u', ' ', strip_tags($text)));
        // Markdown marks stay out of a snippet.
        $plain = trim((string) preg_replace('/[*_#>`~]+/u', '', $plain));

        if (mb_strlen($plain) < self::MEANINGFUL_CHARACTERS || count(preg_split('/\s+/u', $plain) ?: []) < self::MEANINGFUL_WORDS) {
            return null;
        }

        return $plain;
    }

    /**
     * At most MAX characters, cut at a word with an ellipsis.
     */
    private function clip(string $text): string
    {
        $text = str_replace("\u{2060}", '', trim($text));

        if (mb_strlen($text) <= self::MAX) {
            return $text;
        }

        $cut = mb_substr($text, 0, self::MAX - 1);
        $space = mb_strrpos($cut, ' ');

        return rtrim($space !== false && $space > self::MAX / 2 ? mb_substr($cut, 0, $space) : $cut, ' ,;:·–-').'…';
    }
}
