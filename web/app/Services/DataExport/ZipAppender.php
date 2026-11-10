<?php

namespace App\Services\DataExport;

use RuntimeException;

/**
 * A ZIP written in pieces by several queued jobs (SET-12): each job appends entries and the last one writes the central directory.
 * ZipArchive cannot do that cheaply, since closing an archive rewrites all of it; on shared hosting every job must stay under 50 s
 * whatever the archive's size. Entries are stored, not deflated (photos are JPEG already, the JSON is small), with the UTF-8 flag.
 *
 * Plain ZIP, no ZIP64: at most 65535 entries and 4 GiB. The member quota (speedclub.media.quota_mb, 4096 MB for originals and
 * variants together) keeps the originals below that; a larger archive fails loudly instead of writing a broken file.
 *
 * Restartable: open($offset) cuts the file back to the end of the last entry the caller recorded, so a job that died halfway through
 * an entry leaves nothing behind.
 */
final class ZipAppender
{
    private const MAX_OFFSET = 0xFFFFFFFF;

    private const MAX_ENTRIES = 0xFFFF;

    private const CHUNK = 1048576;

    /** @var resource|null */
    private $handle = null;

    public function __construct(private readonly string $path) {}

    public function open(int $offset): void
    {
        $handle = fopen($this->path, 'c+b');

        if ($handle === false) {
            throw new RuntimeException('The export file could not be opened.');
        }

        ftruncate($handle, max(0, $offset));
        fseek($handle, $offset);
        $this->handle = $handle;
    }

    public function offset(): int
    {
        $position = ftell($this->handle());

        return $position === false ? throw new RuntimeException('The export file has no position.') : $position;
    }

    /**
     * @return array{name: string, crc: int, size: int, offset: int, time: int, date: int}
     */
    public function addString(string $name, string $contents): array
    {
        $stream = fopen('php://temp', 'w+b');

        if ($stream === false) {
            throw new RuntimeException('No temporary stream.');
        }

        fwrite($stream, $contents);
        rewind($stream);

        try {
            return $this->addStream($name, $stream);
        } finally {
            fclose($stream);
        }
    }

    /**
     * @param  resource  $stream
     * @return array{name: string, crc: int, size: int, offset: int, time: int, date: int}
     */
    public function addStream(string $name, $stream): array
    {
        $handle = $this->handle();
        $offset = $this->offset();
        [$time, $date] = $this->dosTime(time());

        // The header first with zero CRC and sizes, patched once the data is through: the source is read once.
        $this->write($this->localHeader($name, 0, 0, $time, $date));

        $crc = hash_init('crc32b');
        $size = 0;

        while (! feof($stream)) {
            $chunk = fread($stream, self::CHUNK);

            if ($chunk === false) {
                throw new RuntimeException('A source of the export could not be read.');
            }

            if ($chunk === '') {
                continue;
            }

            hash_update($crc, $chunk);
            $size += strlen($chunk);
            $this->write($chunk);
        }

        $end = $this->offset();

        if ($end > self::MAX_OFFSET) {
            throw new RuntimeException('The export is larger than a plain ZIP can hold.');
        }

        $crcValue = (int) hexdec(hash_final($crc));

        fseek($handle, $offset + 14);
        $this->write(pack('VVV', $crcValue, $size, $size));
        fseek($handle, $end);

        return ['name' => $name, 'crc' => $crcValue, 'size' => $size, 'offset' => $offset, 'time' => $time, 'date' => $date];
    }

    /**
     * Writes the central directory after the last entry and closes the file. Returns the archive's size in bytes.
     *
     * @param  list<array{name: string, crc: int, size: int, offset: int, time: int, date: int}>  $entries
     */
    public function finish(array $entries): int
    {
        if (count($entries) > self::MAX_ENTRIES) {
            throw new RuntimeException('The export has more entries than a plain ZIP can hold.');
        }

        $start = $this->offset();

        foreach ($entries as $entry) {
            $this->write(pack(
                'VvvvvvvVVVvvvvvVV',
                0x02014B50,
                0x031E,      // made by: Unix, 3.0
                20,          // needed to extract: 2.0
                0x0800,      // UTF-8 names
                0,           // stored
                $entry['time'],
                $entry['date'],
                $entry['crc'],
                $entry['size'],
                $entry['size'],
                strlen($entry['name']),
                0,
                0,
                0,
                0,
                0100644 << 16,
                $entry['offset'],
            ).$entry['name']);
        }

        $size = $this->offset() - $start;

        $this->write(pack('VvvvvVVv', 0x06054B50, 0, 0, count($entries), count($entries), $size, $start, 0));

        $total = $this->offset();
        $this->close();

        if ($total > self::MAX_OFFSET) {
            throw new RuntimeException('The export is larger than a plain ZIP can hold.');
        }

        return $total;
    }

    public function close(): void
    {
        if ($this->handle !== null) {
            fflush($this->handle);
            fclose($this->handle);
            $this->handle = null;
        }
    }

    private function localHeader(string $name, int $crc, int $size, int $time, int $date): string
    {
        return pack('VvvvvvVVVvv', 0x04034B50, 20, 0x0800, 0, $time, $date, $crc, $size, $size, strlen($name), 0).$name;
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function dosTime(int $timestamp): array
    {
        $parts = getdate($timestamp);
        $year = max(1980, $parts['year']);

        return [
            ($parts['hours'] << 11) | ($parts['minutes'] << 5) | intdiv($parts['seconds'], 2),
            (($year - 1980) << 9) | ($parts['mon'] << 5) | $parts['mday'],
        ];
    }

    private function write(string $bytes): void
    {
        if (fwrite($this->handle(), $bytes) !== strlen($bytes)) {
            throw new RuntimeException('The export file could not be written.');
        }
    }

    /**
     * @return resource
     */
    private function handle()
    {
        return $this->handle ?? throw new RuntimeException('The export file is not open.');
    }
}
