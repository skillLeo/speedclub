<?php

namespace App\Support\Backups;

use RuntimeException;

/** Thrown when a production backup would be written without BACKUP_ARCHIVE_PASSWORD (BackupEncryption::ensure()). */
final class UnencryptedBackupRefused extends RuntimeException {}
