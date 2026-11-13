<?php

namespace App\Services\PublicPages;

use App\Enums\EventRule;
use App\Enums\EventStatus;
use App\Enums\EventVisibility;
use App\Http\Resources\V1\EventResource;
use App\Models\Event;
use App\Services\Events\EventPresenter;
use App\Services\Showcase\SampleContent;
use App\Support\Viewer;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

/**
 * The data of WEB-09 /e/{slug} (09 §9, EVT-02 as a public page). Always read as a guest: the page is the same for everybody and may be
 * cached and shared, so the exact place of an after_rsvp event never reaches it (EventLocation, ADR-437 c), and the RSVP actions
 * lead into the app. EventResource gives the same values as the app; this class adds what a web page has: the date in words, the map
 * and route links (to openstreetmap.org, opened only by a tap: no third-party request on the page, ADR-449), SEO with JSON-LD and the
 * drawn OG card, and the app links.
 */
final class EventPage
{
    public function __construct(
        private readonly EventPresenter $presenter,
        private readonly PartnerOgImages $og,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function data(Event $event, Request $request): array
    {
        Viewer::treatAsGuest($request);
        $this->presenter->prepare([$event], null);

        /** @var array<string, mixed> $data */
        $data = json_decode((string) json_encode((new EventResource($event))->resolve($request)), true);
        $timezone = (string) ($data['timezone'] ?? 'Europe/Berlin');
        $locale = app()->getLocale();
        $starts = CarbonImmutable::parse((string) $data['starts_at'])->timezone($timezone)->settings(['locale' => $locale]);
        $ends = is_string($data['ends_at'] ?? null) ? CarbonImmutable::parse($data['ends_at'])->timezone($timezone)->settings(['locale' => $locale]) : null;
        $location = $data['location'];
        $sample = ($data['is_sample'] ?? false) === true;
        $cancelled = $event->status === EventStatus::Cancelled;
        $past = $event->hasEnded() || ($ends === null && $starts->isPast());
        $canonical = url('/e/'.$event->slug);
        $images = $this->og->cards($event);
        $organiser = $event->organiser;
        $type = $event->type->label();
        $place = $location['exact'] ? implode(', ', array_filter([$location['venue_name'], $location['city']])) : (string) $location['city'];
        $when = $starts->isoFormat($locale === 'de' ? 'dddd, D. MMMM YYYY' : 'dddd, D MMMM YYYY');
        $description = mb_strimwidth(trim(implode(' · ', array_filter([$type, $when, $place])).'. '.(is_string($data['description']) ? $data['description'] : '')), 0, 160, '…');
        $indexable = ! $sample && $event->visibility === EventVisibility::Public && $organiser->getAttribute('indexable') !== false;

        return [
            'event' => $data,
            'when' => [
                'day' => $starts->isoFormat('D'),
                'month' => $starts->isoFormat('MMM'),
                'weekday' => $starts->isoFormat('dddd'),
                'date' => $when,
                'time' => $ends !== null && $ends->isSameDay($starts)
                    ? __('public.event.time_range', ['from' => $starts->format('H:i'), 'to' => $ends->format('H:i')])
                    : __('public.event.time_from', ['from' => $starts->format('H:i')]),
                'ends' => $ends !== null && ! $ends->isSameDay($starts) ? $ends->isoFormat($locale === 'de' ? 'D. MMMM YYYY, HH:mm' : 'D MMMM YYYY, HH:mm') : null,
                'datetime' => $starts->toIso8601String(),
                'past' => $past,
                'cancelled' => $cancelled,
            ],
            'type' => $type,
            'rules' => array_values(array_map(fn (string $rule): string => EventRule::from($rule)->label(), $data['rules'] ?? [])),
            'map' => $this->map($location),
            'is_sample' => $sample,
            'seo' => [
                'title' => __('public.event.meta_title', ['title' => $event->title, 'city' => $location['city'] ?? '']),
                'description' => $description,
                'canonical' => $canonical,
                'robots' => $indexable ? null : 'noindex',
                'image' => $images['landscape'],
                'image_square' => $images['square'],
                'image_alt' => $event->title,
                'json_ld' => [$this->jsonLd($event, $data, $starts, $ends, $canonical, $images['landscape'])],
            ],
            'links' => PartnerPages::links('e/'.$event->slug, 'events/'.$event->slug),
        ];
    }

    /**
     * "Karte anzeigen" and "Route": addresses on openstreetmap.org, left only by a tap. The area point for an after_rsvp event, which
     * shows a whole district (zoom 12) and has no route.
     *
     * @param  array<string, mixed>  $location
     * @return array{map: string|null, route: string|null}
     */
    private function map(array $location): array
    {
        if ($location['exact'] && is_numeric($location['lat']) && is_numeric($location['lng'])) {
            $lat = (float) $location['lat'];
            $lng = (float) $location['lng'];

            return [
                'map' => sprintf('https://www.openstreetmap.org/?mlat=%1$.5f&mlon=%2$.5f#map=16/%1$.5f/%2$.5f', $lat, $lng),
                'route' => sprintf('https://www.openstreetmap.org/directions?to=%.5f%%2C%.5f', $lat, $lng),
            ];
        }

        $area = $location['area'];

        return [
            'map' => is_numeric($area['lat']) && is_numeric($area['lng']) ? sprintf('https://www.openstreetmap.org/#map=12/%.4f/%.4f', $area['lat'], $area['lng']) : null,
            'route' => null,
        ];
    }

    /**
     * schema.org Event. The place as far as a guest may see it: the city alone for an after_rsvp event (09 §8.7).
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    private function jsonLd(Event $event, array $data, CarbonImmutable $starts, ?CarbonImmutable $ends, string $canonical, string $image): array
    {
        $location = $data['location'];
        $organiser = $data['organiser'];
        $cover = $data['cover']['variants'] ?? [];
        $photo = is_array($cover) && $cover !== [] ? (end($cover)['url'] ?? null) : null;

        return array_filter([
            '@context' => 'https://schema.org',
            '@type' => 'Event',
            'name' => $event->title,
            'url' => $canonical,
            'startDate' => $starts->toIso8601String(),
            'endDate' => $ends?->toIso8601String(),
            'eventStatus' => $event->status === EventStatus::Cancelled ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
            'eventAttendanceMode' => 'https://schema.org/OfflineEventAttendanceMode',
            'description' => is_string($data['description']) && $data['description'] !== '' ? $data['description'] : null,
            'image' => array_values(array_filter([$photo, $image])),
            'location' => [
                '@type' => 'Place',
                'name' => $location['exact'] && $location['venue_name'] !== null ? $location['venue_name'] : $location['city'],
                'address' => array_filter([
                    '@type' => 'PostalAddress',
                    'streetAddress' => $location['exact'] ? $location['street'] : null,
                    'postalCode' => $location['exact'] ? $location['postcode'] : null,
                    'addressLocality' => $location['city'],
                    'addressCountry' => $location['country'],
                ], fn (mixed $value): bool => $value !== null),
            ],
            'organizer' => [
                '@type' => 'Person',
                'name' => $organiser['display_name'] ?? '@'.$organiser['username'],
                'url' => url('/u/'.$organiser['username']),
            ],
            'maximumAttendeeCapacity' => SampleContent::isSample($event) ? null : $event->capacity,
        ], fn (mixed $value): bool => $value !== null && $value !== []);
    }
}
