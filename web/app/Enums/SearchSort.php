<?php

namespace App\Enums;

/**
 * DISC-02 sorts (02_PRODUCT_SPEC §3.7): Relevanz · Neueste · Zuletzt aktualisiert · Meiste PS. Relevance needs a text; without one the
 * search falls back to newest.
 */
enum SearchSort: string
{
    /** The M1.8 relevance of the typed words, then the build changed last. */
    case Relevance = 'relevance';
    /** First published, newest first. */
    case Newest = 'newest';
    /** Last visible change (specs, mods, photos), newest first, as Neue Builds on HOME-01. */
    case Updated = 'updated';
    /** Power in PS, most first; builds without a power figure last. */
    case Power = 'power';
}
