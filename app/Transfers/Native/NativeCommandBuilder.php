<?php

namespace App\Transfers\Native;

use App\Enums\DriverName;
use App\Enums\MySqlSslMode;
use App\Models\SavedConnection;
use App\Transfers\Export\DumpObject;
use App\Transfers\Export\ExportOptions;
use RuntimeException;

/**
 * Builds argv and environment for the native dump and restore tools. The password only ever travels in a 0600
 * options file (MySQL/MariaDB) or PGPASSWORD (PostgreSQL), never in argv. Compatibility already guarantees the
 * tool's flavour matches the connection's driver, so the driver decides MySQL-only flags.
 */
final class NativeCommandBuilder
{
    /**
     * @param  list<DumpObject>  $objects  the chosen objects, used when $o->tables is not null
     * @param  string|null  $outputFile  the tool writes the dump there instead of stdout (pg_dump --file,
     *                                   mysqldump --result-file); it is deleted with the command's temp files
     */
    public static function dump(SavedConnection $c, ToolCheck $t, ExportOptions $o, array $objects, bool $routines, bool $events, ?string $outputFile = null): NativeCommand
    {
        $path = self::toolPath($t);

        if ($c->driver === DriverName::Postgres) {
            return self::pgDump($c, $path, $t, $o, $objects, $outputFile);
        }

        [$file, $temp] = self::defaultsFile($c);
        $argv = [...self::clientHead($c, $path, $file), '--single-transaction', '--no-tablespaces', '--comments'];
        if ($routines) {
            $argv[] = '--routines';
        }
        $argv[] = $o->anyStructure() ? '--triggers' : '--skip-triggers';
        if ($events) {
            $argv[] = '--events';
        }
        if (! $o->anyData()) {
            $argv[] = '--no-data';
        }
        if (! $o->anyStructure()) {
            $argv[] = '--no-create-info';
        } else {
            $argv[] = $o->dropFirst ? '--add-drop-table' : '--skip-add-drop-table';
        }
        array_push($argv, '--hex-blob', '--default-character-set=utf8mb4');
        if ($c->driver === DriverName::MySql) {
            $argv[] = '--set-gtid-purged=OFF';
        }
        if ($o->isMixed() && $c->driver === DriverName::MariaDb) {
            // Tables chosen as structure only are created but their rows left out (coversMix allows no other mix).
            foreach ($objects as $object) {
                if (! $o->dataFor($object->key())) {
                    $argv[] = '--ignore-table-data='.$c->database.'.'.$object->name;
                }
            }
        }
        if ($outputFile !== null) {
            $argv[] = '--result-file='.$outputFile;
        }
        array_push($argv, '--', (string) $c->database);
        if ($o->tables !== null) {
            foreach ($objects as $object) {
                $argv[] = $object->name;
            }
        }

        return new NativeCommand($argv, [], $outputFile !== null ? [$outputFile, ...$temp] : $temp);
    }

    /**
     * Can one run of the native tool produce this table mix? Only mixes of "structure + data" and "structure only"
     * tables on PostgreSQL and MariaDB can; a data-only table, or MySQL's mysqldump, cannot.
     */
    public static function coversMix(DriverName $driver, ExportOptions $o): bool
    {
        if (! $o->isMixed()) {
            return true;
        }

        return in_array($driver, [DriverName::Postgres, DriverName::MariaDb], true)
            && array_diff($o->modeKinds(), ['both', 'structure']) === [];
    }

    public static function restore(SavedConnection $c, ToolCheck $t): NativeCommand
    {
        $path = self::toolPath($t);

        if ($c->driver === DriverName::Postgres) {
            return new NativeCommand(
                [$path, '-X', '-q', '--no-password', '--single-transaction', '-v', 'ON_ERROR_STOP=1', ...self::pgConnectionArgs($c)],
                self::pgEnv($c),
            );
        }

        [$file, $temp] = self::defaultsFile($c);

        $argv = [...self::clientHead($c, $path, $file), '--database='.$c->database, '--default-character-set=utf8mb4', '--binary-mode'];
        // A dump is untrusted input: no `\!` / `system` shell commands, on clients that can switch them off.
        if ($c->driver === DriverName::MariaDb) {
            if (self::atLeast((string) $t->version, ['10.5.25', '10.6.18', '10.11.8', '11.0.6', '11.1.5', '11.2.4', '11.4.2'], '11.5.0')) {
                $argv[] = '--sandbox';
            }
        } elseif (self::atLeast((string) $t->version, ['8.0.40', '8.4.3'], '9.1.0')) {
            $argv[] = '--system-command=OFF';
        }

        return new NativeCommand($argv, [], $temp);
    }

    /**
     * Is $version at least the fixed release of its own branch (major.minor), or at least $from?
     *
     * @param  list<string>  $fixedIn  first fixed release per branch
     */
    private static function atLeast(string $version, array $fixedIn, string $from): bool
    {
        if (version_compare($version, $from, '>=')) {
            return true;
        }
        foreach ($fixedIn as $fixed) {
            [$major, $minor] = explode('.', $fixed);
            if (preg_match('/^'.$major.'\.'.$minor.'(?:\.|$)/', $version) === 1) {
                return version_compare($version, $fixed, '>=');
            }
        }

        return false;
    }

    /** @param list<DumpObject> $objects */
    private static function pgDump(SavedConnection $c, string $path, ToolCheck $t, ExportOptions $o, array $objects, ?string $outputFile): NativeCommand
    {
        $argv = [$path, '--format=plain', '--no-owner', '--no-privileges', '--no-password', ...self::pgConnectionArgs($c)];
        if (! $o->anyData()) {
            $argv[] = '--schema-only';
        } elseif (! $o->anyStructure()) {
            $argv[] = '--data-only';
        }
        if ($o->dropFirst && $o->anyStructure()) {
            array_push($argv, '--clean', '--if-exists');
        }
        if ($o->tables !== null) {
            // --table-and-children (PG 16+) also matches plain tables and pulls in partitions; older tools only have -t.
            $modern = self::major($t) >= 16;
            foreach ($objects as $object) {
                $pattern = ($object->schema !== null ? self::pgQuote($object->schema).'.' : '').self::pgQuote($object->name);
                if ($modern) {
                    $argv[] = '--table-and-children='.$pattern;
                } else {
                    array_push($argv, '-t', $pattern);
                }
            }
            if ($o->isMixed()) {
                // Structure-only tables stay in the dump but lose their rows.
                foreach ($objects as $object) {
                    if (! $o->dataFor($object->key())) {
                        $pattern = ($object->schema !== null ? self::pgQuote($object->schema).'.' : '').self::pgQuote($object->name);
                        $argv[] = ($modern ? '--exclude-table-data-and-children=' : '--exclude-table-data=').$pattern;
                    }
                }
            }
        }

        if ($outputFile !== null) {
            $argv[] = '--file='.$outputFile;
        }

        return new NativeCommand($argv, self::pgEnv($c), $outputFile !== null ? [$outputFile] : []);
    }

    /** Inside double quotes pg_dump patterns take `*`, `?` and `.` literally; only `"` needs doubling. */
    private static function pgQuote(string $part): string
    {
        return '"'.str_replace('"', '""', $part).'"';
    }

    /** @return list<string> */
    private static function pgConnectionArgs(SavedConnection $c): array
    {
        $args = ['--host='.$c->host, '--port='.($c->port ?? 5432)];
        if (filled($c->username)) {
            $args[] = '--username='.$c->username;
        }

        return $args;
    }

    /** @return array<string, string> */
    private static function pgEnv(SavedConnection $c): array
    {
        $options = $c->options ?? [];
        $env = [
            // Via the environment: `--dbname=host=x` would be parsed as a conninfo string and override --host.
            'PGDATABASE' => (string) $c->database,
            'PGSSLMODE' => (string) ($options['sslmode'] ?? 'prefer'),
            'PGCONNECT_TIMEOUT' => (string) (int) config('dbzuper.connect_timeout'),
        ];
        if (filled($c->password)) {
            $env['PGPASSWORD'] = (string) $c->password;
        }
        if (! empty($options['ssl_ca'])) {
            $env['PGSSLROOTCERT'] = (string) $options['ssl_ca'];
        }

        return $env;
    }

    /** @return array{0: string, 1: list<string>} the options file and the paths to delete (file, then its directory) */
    private static function defaultsFile(SavedConnection $c): array
    {
        $options = $c->options ?? [];
        $maria = $c->driver === DriverName::MariaDb;

        $lines = ['[client]', 'protocol=tcp', self::optionLine('user', (string) $c->username)];
        if (filled($c->password)) {
            $lines[] = self::optionLine('password', (string) $c->password);
        }
        $lines[] = self::optionLine('host', (string) $c->host);
        $lines[] = self::optionLine('port', (string) ($c->port ?? 3306));

        switch (MySqlSslMode::fromOptions($options)) {
            case MySqlSslMode::Disabled:
                if ($maria) {
                    $lines[] = 'ssl=0';
                } else {
                    // Without TLS, caching_sha2_password on a cold server cache needs the RSA key (error 2061 otherwise).
                    array_push($lines, 'ssl-mode=DISABLED', 'get-server-public-key=1');
                }
                break;
            case MySqlSslMode::Required:
                if ($maria) {
                    array_push($lines, 'ssl=1', 'ssl-verify-server-cert=0');
                } else {
                    $lines[] = 'ssl-mode=REQUIRED';
                }
                break;
            case MySqlSslMode::VerifyIdentity:
                $lines[] = self::optionLine('ssl-ca', (string) $options['ssl_ca']);
                if ($maria) {
                    array_push($lines, 'ssl=1', 'ssl-verify-server-cert=1');
                } else {
                    $lines[] = 'ssl-mode=VERIFY_IDENTITY';
                }
                break;
        }

        $dir = sys_get_temp_dir().DIRECTORY_SEPARATOR.'dbzuper-'.bin2hex(random_bytes(8));
        if (! mkdir($dir, 0700)) {
            throw new RuntimeException('Could not create a private temporary directory.');
        }
        $file = $dir.DIRECTORY_SEPARATOR.'client.cnf';
        $handle = fopen($file, 'xb');
        if ($handle === false) {
            @rmdir($dir);
            throw new RuntimeException('Could not create the temporary options file.');
        }
        @chmod($file, 0600);
        $written = fwrite($handle, implode("\n", $lines)."\n");
        $closed = fclose($handle);
        if ($written === false || ! $closed) {
            @unlink($file);
            @rmdir($dir);
            throw new RuntimeException('Could not write the temporary options file.');
        }

        return [$file, [$file, $dir]];
    }

    /** One option-file line with the value double-quoted; backslash, double quote and line breaks escaped. */
    private static function optionLine(string $key, string $value): string
    {
        $escaped = strtr($value, ['\\' => '\\\\', '"' => '\\"', "\n" => '\\n', "\r" => '\\r', "\t" => '\\t', "\0" => '']);

        return $key.'="'.$escaped.'"';
    }

    /**
     * Tool, then our options file as the only one read (--defaults-file, not -extra-file, which still reads
     * /etc/my.cnf, ~/.my.cnf and friends), then login paths off where they exist (MySQL 8 clients; MariaDB has none).
     *
     * @return list<string>
     */
    private static function clientHead(SavedConnection $c, string $path, string $file): array
    {
        $head = [$path, '--defaults-file='.$file];
        if ($c->driver === DriverName::MySql) {
            $head[] = '--no-login-paths';
        }

        return $head;
    }

    private static function toolPath(ToolCheck $t): string
    {
        if (! $t->usable || $t->path === null) {
            throw new RuntimeException('No usable native tool.');
        }

        return $t->path;
    }

    private static function major(ToolCheck $t): int
    {
        return (int) explode('.', (string) $t->version)[0];
    }
}
