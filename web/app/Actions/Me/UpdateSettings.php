<?php

namespace App\Actions\Me;

use App\Models\User;
use App\Services\PublicPages\SitemapWriter;
use Illuminate\Support\Facades\DB;

class UpdateSettings
{
    public function __construct(private readonly SitemapWriter $sitemap) {}

    /**
     * @param  array<string, mixed>  $attributes
     */
    public function handle(User $user, array $attributes): User
    {
        $prefs = $attributes['notification_prefs'] ?? null;
        unset($attributes['notification_prefs']);

        DB::transaction(function () use ($user, $attributes, $prefs): void {
            // Under the row lock, so two quick toggles of SET-09 each keep the other's change.
            $current = User::query()->whereKey($user->id)->lockForUpdate()->value('notification_prefs');
            $user->fill($attributes);

            if (is_array($prefs)) {
                $stored = is_string($current) ? json_decode($current, true) : $current;
                // Only what the member changed is stored, never the defaults, so a default changed later still reaches everybody who never
                // touched it (M2.2 review #9). The request admits known keys only; for() merges the defaults when reading.
                $user->setAttribute('notification_prefs', array_replace_recursive(is_array($stored) ? $stored : [], $prefs));
            }

            $user->save();
        });

        // Search engines off: the profile and the vehicles leave the sitemap now, not with the night.
        if ($user->wasChanged('indexable') && $user->getAttribute('indexable') === false) {
            $this->sitemap->forget();
        }

        return $user;
    }
}
