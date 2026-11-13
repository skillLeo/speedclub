<?php

namespace App\Actions\Events;

use App\Enums\ErrorCode;
use App\Enums\EventStatus;
use App\Exceptions\ApiException;
use App\Models\Event;
use App\Models\User;
use App\Services\Rules\ContentScreen;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * EVT-03 step one (09 §7.10): the event starts as a draft with the organiser's acceptance of the event rules; `submit` sends it on at
 * once (SubmitEvent: pre-moderation or published). A cover follows with POST events/{slug}/cover. At most max_open_per_organiser drafts,
 * pending and upcoming events per organiser (409 limit_reached).
 */
class CreateEvent
{
    public function __construct(private readonly SubmitEvent $submit) {}

    /**
     * @param  array<string, mixed>  $data  validated StoreEventRequest data
     */
    public function handle(User $user, array $data, bool $submit): Event
    {
        $flags = EventFields::screen($data);

        $event = DB::transaction(function () use ($user, $data): Event {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');

            $open = Event::query()->where('organiser_id', $user->id)
                ->where(fn ($query) => $query->whereIn('status', [EventStatus::Draft->value, EventStatus::PendingReview->value])
                    ->orWhere(fn ($published) => $published->where('status', EventStatus::Published->value)->where('ends_at', '>=', now())))
                ->count();

            if ($open >= config()->integer('speedclub.events.max_open_per_organiser')) {
                throw new ApiException(ErrorCode::LimitReached, (string) __('events.open_limit', ['max' => config()->integer('speedclub.events.max_open_per_organiser')]));
            }

            $event = new Event;
            EventFields::fill($event, $data);
            $event->forceFill([
                'organiser_id' => $user->id,
                'slug' => self::slug((string) $data['title']),
                'status' => EventStatus::Draft,
                'timezone' => 'Europe/Berlin',
                'rules_accepted_at' => now(),
            ])->save();

            // The column defaults (visibility, location_visibility, country) on the instance; wasRecentlyCreated stays (201).
            return $event->refresh();
        });

        app(ContentScreen::class)->flagAfterCommit($flags, $event);

        if ($submit) {
            $this->submit->handle($user, $event);
            $event->refresh();
        }

        return $event;
    }

    /**
     * "beispiel-treffen-hafen-7k2m9q": the title (ASCII, 100 at most) and six random characters, stable for the event's life.
     */
    public static function slug(string $title): string
    {
        $base = Str::limit(Str::slug($title, '-', 'de'), 100, '') ?: 'treffen';

        do {
            $slug = rtrim($base, '-').'-'.Str::lower(Str::random(6));
        } while (Event::query()->where('slug', $slug)->exists());

        return $slug;
    }
}
