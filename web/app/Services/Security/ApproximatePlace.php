<?php

namespace App\Services\Security;

/**
 * "in der Nähe von München" for SET-06, SET-21 and the new-device mail (09 §8.4): only with a GeoLite2 City database (owner action OA-33), and
 * then from the address in memory, never stored. Until the database and a reader library are installed this answers null, so no place
 * is shown anywhere. The resolver is the one seam for that: bind another implementation in a service provider.
 */
class ApproximatePlace
{
    public function city(?string $ip): ?string
    {
        // No reader is installed yet (composer geoip2/geoip2 and the .mmdb file, OA-33): no place, rather than a guess.
        return null;
    }

    /**
     * Whether places can show at all, so a client can leave the line out instead of showing "Ort unbekannt".
     */
    public function available(): bool
    {
        return false;
    }
}
