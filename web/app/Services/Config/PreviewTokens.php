<?php

namespace App\Services\Config;

use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Enums\ContentEvent;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Throwable;

/**
 * Signed draft preview tokens (ADM-34, m3.5 §1a): HMAC-signed with the app key, valid speedclub.content.preview_minutes (15), bound to
 * the staff member who issued it. A token names only that staff member's own drafts (one per key, ConfigVersions), so it can never show
 * another staff member's draft; at use the staff member must still be active and hold content.view, and each draft must still be theirs.
 *
 * Read-only by construction: the token is read only for GET and HEAD (query `preview` or header `X-Preview-Token`), only by readers
 * (AppConfig, HomeCuration); no write path consults it, and nothing it selects is ever published. With a token, maintenance mode is
 * bypassed unless the token's remote_config draft is itself what is previewed (the staff bypass of ADM-37).
 */
final class PreviewTokens
{
    public const QUERY = 'preview';

    public const HEADER = 'X-Preview-Token';

    private const ATTRIBUTE = 'speedclub.preview';

    private const ATOM = 'content.view';

    /**
     * @return array{token: string, expires_at: string, keys: list<string>}
     *
     * @throws AuthorizationException
     */
    public function issue(Staff $staff): array
    {
        StaffAtoms::ensure($staff, self::ATOM);

        $keys = array_map(fn (ConfigKey $key): string => $key->value, array_values(array_filter(ConfigKey::cases(), fn (ConfigKey $key): bool => $key->inAppConfig())));
        $drafts = ConfigVersion::query()->whereIn('key', $keys)->where('status', ConfigVersionStatus::Draft)->where('created_by', $staff->getKey())
            ->pluck('id', 'key')->map(fn (mixed $id): int => (int) $id)->all();
        $expires = now()->addMinutes(config()->integer('speedclub.content.preview_minutes'));

        $body = $this->encode((string) json_encode([
            's' => (int) $staff->getKey(),
            'd' => (object) $drafts,
            'e' => $expires->getTimestamp(),
            'n' => bin2hex(random_bytes(8)),
        ], JSON_THROW_ON_ERROR));
        $token = $body.'.'.$this->encode($this->sign($body));

        Audit::record(ContentEvent::PreviewIssued->value, $staff, after: ['keys' => array_keys($drafts), 'expires_at' => $expires->toIso8601ZuluString()], actor: $staff);

        return ['token' => $token, 'expires_at' => $expires->toIso8601ZuluString(), 'keys' => array_keys($drafts)];
    }

    /**
     * The context of a valid token, else null (bad signature, expired, staff inactive or without the atom).
     */
    public function resolve(string $token): ?PreviewContext
    {
        $parts = explode('.', $token);

        if (count($parts) !== 2 || strlen($token) > 2048) {
            return null;
        }

        [$body, $signature] = $parts;

        if (! hash_equals($this->encode($this->sign($body)), $signature)) {
            return null;
        }

        try {
            $data = json_decode($this->decode($body), true, 4, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            return null;
        }

        if (! is_array($data) || ! is_int($data['s'] ?? null) || ! is_int($data['e'] ?? null) || ! is_array($data['d'] ?? null) || $data['e'] < now()->getTimestamp()) {
            return null;
        }

        $staff = Staff::query()->find($data['s']);

        if (! $staff instanceof Staff || ! $staff->isActive() || ! $staff->can(self::ATOM)) {
            return null;
        }

        $payloads = [];
        $ids = array_filter(array_map(fn (mixed $id): int => is_int($id) ? $id : 0, $data['d']));
        $rows = ConfigVersion::query()->whereKey(array_values($ids))->where('status', ConfigVersionStatus::Draft)->where('created_by', $staff->getKey())->get();

        foreach ($rows as $row) {
            $key = ConfigKey::tryFrom($row->key);

            if ($key !== null && $key->inAppConfig() && ($ids[$key->value] ?? null) === $row->getKey()) {
                $payloads[$key->value] = $row->payload;
            }
        }

        return new PreviewContext($staff, $payloads, Carbon::createFromTimestamp($data['e']));
    }

    /**
     * The preview of the current request, read once per request; null outside GET/HEAD and without a valid token.
     */
    public function current(): ?PreviewContext
    {
        if (! app()->bound('request')) {
            return null;
        }

        /** @var Request $request */
        $request = app('request');
        $attributes = $request->attributes;

        if ($attributes->has(self::ATTRIBUTE)) {
            $cached = $attributes->get(self::ATTRIBUTE);

            return $cached instanceof PreviewContext ? $cached : null;
        }

        $token = $request->isMethodCacheable() ? ($request->query(self::QUERY) ?? $request->headers->get(self::HEADER)) : null;
        $context = is_string($token) && $token !== '' ? $this->resolve($token) : null;
        $attributes->set(self::ATTRIBUTE, $context ?? false);

        return $context;
    }

    private function sign(string $body): string
    {
        return hash_hmac('sha256', 'speedclub.preview|'.$body, config()->string('app.key'), true);
    }

    private function encode(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    private function decode(string $text): string
    {
        return (string) base64_decode(strtr($text, '-_', '+/'), true);
    }
}
