<?php

namespace App\Services\Events;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * The geocoding proxy of EVT-03 (09 §8.7, ADR-411): Nominatim's search behind the server, so no key and no device address ever reach the
 * provider. Search on submit only (the app sends a query when the organiser taps "Suchen"), at most one upstream request a second for
 * the whole host (Nominatim usage policy), a descriptive User-Agent with the contact address of config, answers cached 30 days per
 * query and language. The upstream host comes from config only, never from a request.
 *
 * @phpstan-type Place array{label: string, venue_name: string|null, street: string|null, postcode: string|null, city: string|null, country: string|null, lat: float, lng: float}
 */
class Geocoder
{
    private const UPSTREAM_KEY = 'geocode:nominatim:upstream';

    /**
     * @return list<Place>
     *
     * @throws ApiException 503 geocode_unavailable
     */
    public function search(string $query, string $locale): array
    {
        $normalised = mb_strtolower(trim(preg_replace('/\s+/u', ' ', $query) ?? ''));
        $key = 'geocode:v1:'.hash('sha256', $locale.'|'.$normalised);

        /** @var list<Place>|null $cached */
        $cached = Cache::get($key);

        if (is_array($cached)) {
            return $cached;
        }

        $places = $this->fetch($normalised, $locale);
        Cache::put($key, $places, now()->addDays(config()->integer('speedclub.geocode.cache_days')));

        return $places;
    }

    public function userAgent(): string
    {
        $contact = config('speedclub.geocode.contact_email');
        $site = config()->string('app.url');

        return 'SPEEDCLUB/2.0 (+'.$site.(is_string($contact) && $contact !== '' ? '; '.$contact : '').')';
    }

    /**
     * @return list<Place>
     */
    private function fetch(string $query, string $locale): array
    {
        $this->waitForUpstreamSlot();

        try {
            $response = Http::baseUrl(rtrim(config()->string('speedclub.geocode.nominatim_url'), '/'))
                ->withHeaders(['User-Agent' => $this->userAgent(), 'Accept-Language' => $locale])
                ->timeout(config()->integer('speedclub.geocode.timeout_seconds'))
                ->acceptJson()
                ->get('/search', [
                    'q' => $query,
                    'format' => 'jsonv2',
                    'addressdetails' => 1,
                    'limit' => config()->integer('speedclub.geocode.limit'),
                    'countrycodes' => config()->string('speedclub.geocode.countries'),
                ]);
        } catch (ConnectionException) {
            throw new ApiException(ErrorCode::GeocodeUnavailable);
        }

        if (! $response->successful() || ! is_array($response->json())) {
            throw new ApiException(ErrorCode::GeocodeUnavailable);
        }

        $places = [];

        foreach ($response->json() as $row) {
            if (is_array($row) && is_numeric($row['lat'] ?? null) && is_numeric($row['lon'] ?? null)) {
                $places[] = $this->place($row);
            }
        }

        return $places;
    }

    /**
     * @param  array<string, mixed>  $row
     * @return Place
     */
    private function place(array $row): array
    {
        $address = is_array($row['address'] ?? null) ? $row['address'] : [];
        $part = fn (string ...$keys): ?string => collect($keys)->map(fn (string $key): mixed => $address[$key] ?? null)->first(fn (mixed $value): bool => is_string($value) && $value !== '');
        $street = $part('road', 'pedestrian', 'footway');
        $number = $part('house_number');
        $name = is_string($row['name'] ?? null) && $row['name'] !== '' ? $row['name'] : null;
        $country = $part('country_code');

        return [
            'label' => mb_substr((string) ($row['display_name'] ?? ''), 0, 300),
            'venue_name' => $name !== null && $name !== $street ? mb_substr($name, 0, 120) : null,
            'street' => $street === null ? null : mb_substr(trim($street.' '.($number ?? '')), 0, 160),
            'postcode' => $part('postcode'),
            'city' => $part('city', 'town', 'village', 'municipality', 'county'),
            'country' => $country === null ? null : mb_strtoupper($country),
            'lat' => round((float) $row['lat'], 6),
            'lng' => round((float) $row['lon'], 6),
        ];
    }

    /**
     * One upstream request a second for the whole host: wait up to 1.2 s for the slot, else 503 (the app lets the organiser retry).
     */
    private function waitForUpstreamSlot(): void
    {
        $deadline = microtime(true) + 1.2;

        // Security review L5: Cache::add is one atomic insert on every store (the database cache included), unlike the read-then-write of
        // RateLimiter::attempt; one key per wall-clock second is that second's slot.
        while (! Cache::add(self::UPSTREAM_KEY.':'.time(), true, 5)) {
            if (microtime(true) >= $deadline) {
                throw new ApiException(ErrorCode::GeocodeUnavailable);
            }

            usleep(100_000);
        }
    }
}
