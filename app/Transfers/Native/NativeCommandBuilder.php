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
    /** @param list<DumpObject> $objects the chosen objects, used when $o->tables is not null */
    public static function dump(SavedConnection $c, ToolCheck $t, ExportOptions $o, array $objects, bool $routines, bool $events): NativeCommand
    {
        $path = self::toolPath($t);

        if ($c->driver === DriverName::Postgres) {
            return self::pgDump($c, $path, $t, $o, $objects);
        }

        [$file, $temp] = self::defaultsFile($c);
        $argv = [$path, '--defaults-extra-file='.$file, '--single-transaction', '--no-tablespaces'];
        if ($routines) {
            $argv[] = '--routines';
        }
        $argv[] = $o->structure ? '--triggers' : '--skip-triggers';
        if ($events) {
            $argv[] = '--events';
        }
        if (! $o->data) {
            $argv[] = '--no-data';
        }
        if (! $o->structure) {
            $argv[] = '--no-create-info';
        } else {
            $argv[] = $o->dropFirst ? '--add-drop-table' : '--skip-add-drop-table';
        }
        array_push($argv, '--hex-blob', '--default-character-set=utf8mb4');
        if ($c->driver === DriverName::MySql) {
            $argv[] = '--set-gtid-purged=OFF';
        }
        $argv[] = (string) $c->database;
        if ($o->tables !== null) {
            foreach ($objects as $object) {
                $argv[] = $object->name;
            }
        }

        return new NativeCommand($argv, [], $temp);
    }

    public static function restore(SavedConnection $c, ToolCheck $t): NativeCommand
    {
        $path = self::toolPath($t);

        if ($c->driver === DriverName::Postgres) {
            return new NativeCommand(
                [$path, '-X', '-q', '--single-transaction', '-v', 'ON_ERROR_STOP=1', ...self::pgConnectionArgs($c)],
                self::pgEnv($c),
            );
        }

        [$file, $temp] = self::defaultsFile($c);

        return new NativeCommand(
            [$path, '--defaults-extra-file='.$file, '--database='.$c->database, '--default-character-set=utf8mb4', '--binary-mode'],
            [],
            $temp,
        );
    }

    /** @param list<DumpObject> $objects */
    private static function pgDump(SavedConnection $c, string $path, ToolCheck $t, ExportOptions $o, array $objects): NativeCommand
    {
        $argv = [$path, '--format=plain', '--no-owner', '--no-privileges', ...self::pgConnectionArgs($c)];
        if (! $o->data) {
            $argv[] = '--schema-only';
        } elseif (! $o->structure) {
            $argv[] = '--data-only';
        }
        if ($o->dropFirst && $o->structure) {
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
        }

        return new NativeCommand($argv, self::pgEnv($c));
    }

    /** Inside double quotes pg_dump patterns take `*`, `?` and `.` literally; only `"` needs doubling. */
    private static function pgQuote(string $part): string
    {
        return '"'.str_replace('"', '""', $part).'"';
    }

    /** @return list<string> */
    private static function pgConnectionArgs(SavedConnection $c): array
    {
        $args = ['--dbname='.$c->database, '--host='.$c->host, '--port='.($c->port ?? 5432)];
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
                $lines[] = $maria ? 'ssl=0' : 'ssl-mode=DISABLED';
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
        fwrite($handle, implode("\n", $lines)."\n");
        fclose($handle);

        return [$file, [$file, $dir]];
    }

    /** One option-file line with the value double-quoted; backslash, double quote and line breaks escaped. */
    private static function optionLine(string $key, string $value): string
    {
        $escaped = strtr($value, ['\\' => '\\\\', '"' => '\\"', "\n" => '\\n', "\r" => '\\r', "\t" => '\\t', "\0" => '']);

        return $key.'="'.$escaped.'"';
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
