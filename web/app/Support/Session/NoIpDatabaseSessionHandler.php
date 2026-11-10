<?php

namespace App\Support\Session;

use Illuminate\Session\DatabaseSessionHandler;

/**
 * The database session driver without the IP address (lead ruling, ADR-113: member IPs are not stored; 02_PRODUCT_SPEC §3.1 lists
 * sessions without one). The user agent stays: SET-06 names the browser from it ("Chrome auf macOS"). Registered for the `database`
 * driver in AppServiceProvider; the column stays and is always null.
 */
class NoIpDatabaseSessionHandler extends DatabaseSessionHandler
{
    protected function ipAddress(): ?string
    {
        return null;
    }
}
