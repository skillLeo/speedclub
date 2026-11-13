<?php

namespace App\Services\Social;

use App\Enums\MentionPrivacy;
use App\Enums\UserStatus;
use App\Models\Follow;
use App\Models\Mention;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Discover\VisibleBuilds;
use App\Support\Username;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * Mentions (09 §8.5, flag `mentions`): "@lukas.sc" in a build update or a comment. The text keeps what the author wrote; a mention is
 * stored by member id only when it is allowed, so it links and notifies:
 *
 * - the member exists, can be seen (active, verified, not deleted; a sample member only while editorial_samples is on) and is not the
 *   author;
 * - no block in either direction;
 * - the member's "Wer darf mich erwähnen" allows the author: everyone, followers (the author follows the member) or nobody.
 *
 * Anything else stays plain text and nobody learns why. At most speedclub.social_2.max_mentions per text (mention spam), and an edit
 * notifies only members who were not mentioned before.
 */
final class Mentions
{
    public const FLAG = 'mentions';

    /** "@" not preceded by a name character, then a username as Username allows it (a trailing dot is punctuation). */
    private const PATTERN = '/(?<![\p{L}\p{N}._@])@([a-z0-9][a-z0-9._]{0,63})/iu';

    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly FeatureFlags $flags,
    ) {}

    public function enabled(): bool
    {
        return $this->flags->enabled(self::FLAG);
    }

    /**
     * The usernames named in $text, lower case, in order, without repeats, at most the limit.
     *
     * @return list<string>
     */
    public static function parse(?string $text): array
    {
        if ($text === null || preg_match_all(self::PATTERN, $text, $matches) === false) {
            return [];
        }

        $names = [];

        foreach ($matches[1] as $name) {
            $name = rtrim(Username::normalize($name), '.');

            if ($name !== '' && ! in_array($name, $names, true)) {
                $names[] = $name;
            }
        }

        return array_slice($names, 0, config()->integer('speedclub.social_2.max_mentions'));
    }

    /**
     * Stores the allowed mentions of $text on $item (a build update or a comment) and removes the ones the text no longer names. Returns
     * the members mentioned for the first time, for the notification. Nothing while the flag is off.
     *
     * @return list<User>
     */
    public function sync(Model $item, User $author, ?string $text): array
    {
        $type = $item->getMorphClass();
        $id = (string) $item->getKey();

        if (! $this->enabled()) {
            return [];
        }

        $allowed = $this->allowedMembers($author, self::parse($text));
        $before = Mention::query()->where('mentionable_type', $type)->where('mentionable_id', $id)->pluck('mentioned_user_id')->map(strval(...))->all();
        $now = array_map(fn (User $member): string => (string) $member->getKey(), $allowed);

        $gone = array_values(array_diff($before, $now));

        if ($gone !== []) {
            Mention::query()->where('mentionable_type', $type)->where('mentionable_id', $id)->whereIn('mentioned_user_id', $gone)->delete();
        }

        $new = array_values(array_filter($allowed, fn (User $member): bool => ! in_array((string) $member->getKey(), $before, true)));

        if ($new !== []) {
            Mention::query()->insertOrIgnore(array_map(fn (User $member): array => [
                'mentionable_type' => $type,
                'mentionable_id' => $id,
                'mentioned_user_id' => $member->getKey(),
                'author_id' => $author->getKey(),
                'created_at' => now(),
            ], $new));
        }

        return $new;
    }

    public static function forget(Model $item): void
    {
        Mention::query()->where('mentionable_type', $item->getMorphClass())->where('mentionable_id', (string) $item->getKey())->delete();
    }

    /**
     * The mentioned members of each item that $viewer may see now, for the resources: item id => members in the order of the text's
     * first naming is not kept, so by username.
     *
     * @param  list<string>  $ids
     * @return array<string, list<User>>
     */
    public function forItems(string $type, array $ids, ?User $viewer): array
    {
        if ($ids === [] || ! $this->enabled()) {
            return [];
        }

        $rows = Mention::query()
            ->where('mentionable_type', $type)
            ->whereIn('mentionable_id', $ids)
            ->whereHas('mentioned', fn (Builder $member) => $this->visible($member, $viewer))
            ->with('mentioned.avatar')
            ->get();

        $map = [];

        foreach ($rows as $row) {
            $member = $row->mentioned;

            if ($member instanceof User) {
                $map[$row->mentionable_id][] = $member;
            }
        }

        foreach ($map as $id => $members) {
            usort($members, fn (User $a, User $b): int => strcmp((string) $a->username, (string) $b->username));
            $map[$id] = $members;
        }

        return $map;
    }

    /**
     * UPD-01 autocomplete: members $viewer follows or who follow $viewer, then members $viewer mentioned before, whose username or name
     * starts with $query and who would accept the mention.
     *
     * @return Collection<int, User>
     */
    public function suggest(User $viewer, string $query, int $limit): Collection
    {
        $query = Username::normalize(ltrim(trim($query), '@'));
        $like = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $query).'%';

        $close = fn (QueryBuilder $ids) => $ids->select('followee_id')->from('follows')->where('follower_id', $viewer->id)
            ->union(DB::query()->select('follower_id')->from('follows')->where('followee_id', $viewer->id))
            ->union(DB::query()->select('mentioned_user_id')->from('mentions')->where('author_id', $viewer->id));

        $members = User::query()
            ->whereIn('users.id', $close)
            ->where(fn (Builder $match) => $match->where('users.username', 'like', $like)->orWhere('users.display_name', 'like', $like))
            ->where('users.id', '!=', $viewer->id)
            ->where('users.mention_privacy', '!=', MentionPrivacy::Nobody->value)
            ->where(fn (Builder $privacy) => $privacy
                ->where('users.mention_privacy', MentionPrivacy::Everyone->value)
                ->orWhereExists(fn (QueryBuilder $follows) => $follows->selectRaw('1')->from('follows', 'mf')
                    ->where('mf.follower_id', $viewer->id)->whereColumn('mf.followee_id', 'users.id')))
            ->tap(fn (Builder $visible) => $this->visible($visible, $viewer))
            ->with('avatar')
            ->orderBy('users.username')
            ->limit($limit);

        return $members->get();
    }

    /**
     * @param  list<string>  $usernames
     * @return list<User>
     */
    private function allowedMembers(User $author, array $usernames): array
    {
        if ($usernames === []) {
            return [];
        }

        $members = User::query()->whereIn('username', $usernames)->where('id', '!=', $author->id)
            ->tap(fn (Builder $visible) => $this->visible($visible, $author))
            ->get();

        return array_values($members->filter(fn (User $member): bool => self::allows($author, $member))->all());
    }

    /**
     * Whether $member's "Wer darf mich erwähnen" lets $author mention them.
     */
    public static function allows(User $author, User $member): bool
    {
        $privacy = $member->getAttribute('mention_privacy');

        return match ($privacy instanceof MentionPrivacy ? $privacy : MentionPrivacy::Everyone) {
            MentionPrivacy::Everyone => true,
            MentionPrivacy::Followers => Follow::query()->where('follower_id', $author->id)->where('followee_id', $member->id)->exists(),
            MentionPrivacy::Nobody => false,
        };
    }

    /**
     * Members anybody may see, without a block either way to $viewer, and without samples while they are hidden.
     *
     * @param  Builder<User>  $query
     * @return Builder<User>
     */
    private function visible(Builder $query, ?User $viewer): Builder
    {
        $query->whereNull('users.deleted_at')
            ->whereNotNull('users.username')
            ->where('users.status', UserStatus::Active->value)
            ->whereNotNull('users.email_verified_at');

        $this->builds->withoutSamples($query->getQuery(), 'users.is_sample');
        $this->builds->withoutBlocks($query->getQuery(), $viewer, 'users.id');

        return $query;
    }
}
