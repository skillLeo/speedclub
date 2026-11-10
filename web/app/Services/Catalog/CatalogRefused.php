<?php

namespace App\Services\Catalog;

use DomainException;

/**
 * A catalogue change the rules of m3.3 §1 refuse (the world, not the input): the entry is referenced, the field has data, the slug is
 * taken. `code` is the key the admin page translates (`catalog.refused.<code>` in lang/admin/<locale>/catalog.json); `count` the
 * number that explains it ("23 Modifikationen"). A DomainException, so a four-eyes execution ends as failed instead of half done.
 *
 * Codes: referenced, slug_locked, slug_taken, merged, same_entry, merge_level, field_has_data, field_key_locked, field_type_locked,
 * field_narrowing, field_not_archived, category_key_locked, fields_mismatch, request_resolved, import_state, import_file_changed,
 * import_expired.
 */
final class CatalogRefused extends DomainException
{
    /**
     * @param  array<string, scalar|null>  $context
     */
    public function __construct(public readonly string $reason, public readonly int $count = 0, public readonly array $context = [])
    {
        parent::__construct("catalog.refused.$reason".($count > 0 ? " ($count)" : ''));
    }
}
