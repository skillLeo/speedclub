<?php

namespace App\Actions\Admin\Config;

use App\Models\Staff;
use App\Services\Config\PreviewTokens;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * ADM-34: a signed preview token (15 min, bound to this staff member, read-only) that makes GET app-config, Home's featured slot and
 * the public pages show this staff member's own drafts for requests carrying `?preview=<token>` (or the X-Preview-Token header).
 * Needs content.view; audited as `config.preview_issued` (keys and expiry, never the token).
 */
final class IssuePreviewToken
{
    public function __construct(private readonly PreviewTokens $tokens) {}

    /**
     * @return array{token: string, expires_at: string, keys: list<string>}
     *
     * @throws AuthorizationException
     */
    public function handle(Staff $staff): array
    {
        return $this->tokens->issue($staff);
    }
}
