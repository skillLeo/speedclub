<?php

// One file per module in routes/admin (05_ARCHITECTURE §5). Prefix "admin", name "admin." and the
// middleware groups ['web', 'staff'] come from bootstrap/app.php.
foreach (glob(__DIR__.'/admin/*.php') ?: [] as $file) {
    require $file;
}
