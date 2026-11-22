<?php

namespace App\Transfers\Native;

use Symfony\Component\Process\Exception\ProcessSignaledException;
use Symfony\Component\Process\InputStream;
use Symfony\Component\Process\Process;
use Throwable;

/**
 * Runs a native dump or restore tool and streams its stdout to a callback, chunk by chunk, so no output is ever held
 * whole in memory. stderr is kept as a bounded tail for the error message. The child starts from the parent's
 * environment without its PG* / MYSQL_* / MARIADB_* variables (a stray PGSERVICE, PGHOST or MYSQL_PWD must not
 * redirect the tool or change its login); the command's own variables are added after that.
 */
final class NativeProcess
{
    /** stderr bytes kept for the error message (the end, where the tools put the error). */
    public const STDERR_BYTES = 65_536;

    /** Inherited variables matching this are removed from the child's environment. */
    private const CONNECTION_VARIABLES = '/^(?:PG|MYSQL_|MARIADB_)/i';

    private readonly Process $process;

    private string $stderr = '';

    public function __construct(NativeCommand $command, private readonly ?string $secret = null, ?InputStream $input = null)
    {
        $this->process = new Process($command->argv, null, self::environment($command->env), $input, null);
    }

    /**
     * The child's environment as Symfony Process takes it: false removes an inherited variable.
     *
     * @param  array<string, string>  $extra
     * @param  list<string>|null  $inherited  names of the parent's variables (default: the real ones)
     * @return array<string, string|false>
     */
    public static function environment(array $extra, ?array $inherited = null): array
    {
        $env = [];
        foreach ($inherited ?? self::inheritedNames() as $name) {
            if (preg_match(self::CONNECTION_VARIABLES, $name)) {
                $env[$name] = false;
            }
        }

        return array_replace($env, $extra);
    }

    /**
     * Starts the process and runs it to the end. $tick runs at least every few milliseconds (also while the tool is
     * quiet); when it or $onStdout throws, the process is killed and the exception rethrown.
     *
     * @param  callable(string): void  $onStdout
     * @param  callable(): void  $tick
     * @return int the exit code
     */
    public function run(callable $onStdout, callable $tick): int
    {
        try {
            $this->process->start();

            foreach ($this->process->getIterator(Process::ITER_NON_BLOCKING) as $type => $data) {
                if ($type === Process::ERR) {
                    $this->stderr = substr($this->stderr.$data, -self::STDERR_BYTES);
                } elseif ($data !== '') {
                    $onStdout($data);
                } else {
                    usleep(1_000); // nothing to read: don't spin
                }
                $tick();
            }

            return $this->process->wait();
        } catch (ProcessSignaledException $e) {
            $this->stderr .= "\nterminated by signal ".$e->getSignal();

            return 128 + $e->getSignal();
        } catch (Throwable $e) {
            $this->kill();

            throw $e;
        }
    }

    /** The end of the tool's stderr, without credentials. */
    public function stderr(): string
    {
        return self::sanitize($this->stderr, $this->secret);
    }

    /** Removes the password itself and anything shaped like `password=…` / `PGPASSWORD=…` / `MYSQL_PWD=…`. */
    public static function sanitize(string $text, ?string $secret = null): string
    {
        if ($secret !== null && $secret !== '') {
            $text = str_replace($secret, '***', $text);
        }
        // "(using password: YES)" in MySQL's access-denied message says nothing secret and stays readable.
        $text = (string) preg_replace(
            '/\b(PGPASSWORD|MYSQL_PWD|password)(\s*[=:]\s*)(?!(?:YES|NO)\b)("[^"]*"|\'[^\']*\'|\S+)/i',
            '$1$2***',
            $text,
        );

        return trim(mb_scrub($text, 'UTF-8'));
    }

    private function kill(): void
    {
        try {
            $this->process->stop(0);
        } catch (Throwable) {
            // Already gone; the original exception matters more.
        }
    }

    /** @return list<string> */
    private static function inheritedNames(): array
    {
        $names = array_keys(getenv());
        foreach ([$_ENV, $_SERVER] as $source) {
            foreach ($source as $name => $value) {
                if (is_string($value)) {
                    $names[] = (string) $name;
                }
            }
        }

        return array_values(array_unique(array_map('strval', $names)));
    }
}
