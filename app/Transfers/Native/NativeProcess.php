<?php

namespace App\Transfers\Native;

use LogicException;
use RuntimeException;
use Throwable;

/**
 * Runs a native dump or restore tool with proc_open and streams its stdout (and, for restores, its stdin) in small
 * chunks, so memory stays flat for any dump size and nothing of the dump is copied to disk on the way.
 *
 * - stdout/stdin are pipes on Linux, polled with stream_select. On Windows, pipes can't be polled (a blocking read
 *   of a quiet tool would delay a cancel indefinitely) and socket stdout loses its tail when the tool exits right
 *   after writing (abortive close). So on Windows a dump tool writes its own output file, which is tailed in
 *   bounded reads while the process is polled and drained to the end after it exits; stdin (restores) is a socket,
 *   which delivers intact in that direction. Capturing stdout over a socket on Windows is refused.
 * - stderr goes to a temporary file (tools write little there); its last 64 KB are kept for the error message.
 * - The child gets an allow-listed environment only (PATH, temp dirs, locale…) plus the command's own variables:
 *   nothing like APP_KEY, DB_PASSWORD, PGSERVICE or MYSQL_PWD leaks in from the worker.
 * - argv goes to the tool directly, never through a shell.
 */
final class NativeProcess
{
    /** stderr bytes kept for the error message (the end, where the tools put the error). */
    public const STDERR_BYTES = 65_536;

    /** Most stdout handed to the callback at once. */
    private const READ_BYTES = 65_536;

    /** Most stdout read per loop before stdin, the tick and the process status get a turn. */
    private const READ_PER_LOOP = 1_048_576;

    /** Inherited variables the child may see, compared case-insensitively (Windows spells them Path, SystemRoot…). */
    private const ALLOWED_ENV = [
        'PATH', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR', 'HOME',
        'USERPROFILE', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ',
    ];

    private string $stderr = '';

    public function __construct(private readonly NativeCommand $command, private readonly ?string $secret = null) {}

    /**
     * The child's whole environment: the allow-listed parent variables, then $extra.
     *
     * @param  array<string, string>  $extra
     * @param  array<string, string>|null  $parent  the parent's variables (default: the real ones)
     * @return array<string, string>
     */
    public static function environment(array $extra, ?array $parent = null): array
    {
        $env = [];
        foreach ($parent ?? getenv() as $name => $value) {
            if (in_array(strtoupper((string) $name), self::ALLOWED_ENV, true)) {
                $env[(string) $name] = (string) $value;
            }
        }

        return array_replace($env, $extra);
    }

    /**
     * Runs the tool to the end and returns its exit code. $tick runs every loop (at least every ~0.2 s, also while
     * the tool is quiet) until stdin has been closed: after the end of input, the client finishes on its own (psql
     * then commits) and the exit code tells the outcome. When a callback throws, the tool is killed first (stdin
     * still open, so psql can't take it as the end of input) and the exception rethrown.
     *
     * @param  (callable(string): void)|null  $onStdout  null: the output is discarded
     * @param  callable(): void  $tick
     * @param  (callable(): ?string)|null  $input  the next chunk for stdin, null at the end; null: no stdin
     * @param  string|null  $outputFile  the tool writes its output there (it was told so in argv); the file is
     *                                   tailed into $onStdout instead of reading stdout
     */
    public function run(?callable $onStdout, callable $tick, ?callable $input = null, ?string $outputFile = null): int
    {
        $windows = PHP_OS_FAMILY === 'Windows';
        $null = $windows ? 'NUL' : '/dev/null';
        if ($windows && $onStdout !== null && $outputFile === null) {
            throw new LogicException('On Windows a tool\'s output is read from the file it writes, never from a socket.');
        }
        if ($outputFile !== null && $input !== null) {
            throw new LogicException('A tool writing an output file takes no input.');
        }
        $errorPath = (string) tempnam(sys_get_temp_dir(), 'dbz-stderr-');

        $spec = [
            0 => $input !== null ? ($windows ? ['socket'] : ['pipe', 'r']) : ['file', $null, 'r'],
            1 => $onStdout === null || $outputFile !== null ? ['file', $null, 'w'] : ['pipe', 'w'],
            2 => ['file', $errorPath, 'w'],
        ];
        $process = null;
        $pipes = [];

        try {
            $process = @proc_open($this->command->argv, $spec, $pipes, null, self::environment($this->command->env), ['bypass_shell' => true]);
            if (! is_resource($process)) {
                throw new RuntimeException('Could not start '.basename($this->command->argv[0]).'.');
            }

            $exit = $outputFile !== null && $onStdout !== null
                ? $this->tail($process, $outputFile, $onStdout, $tick)
                : $this->loop($process, $pipes, $onStdout, $tick, $input);
        } catch (Throwable $e) {
            if (is_resource($process)) {
                @proc_terminate($process, 9);
            }
            $this->close($pipes);
            if (is_resource($process)) {
                @proc_close($process);
            }
            $this->readStderr($errorPath);

            throw $e;
        }

        $this->close($pipes);
        @proc_close($process);
        $this->readStderr($errorPath);

        return $exit;
    }

    /** The end of the tool's stderr, without credentials. */
    public function stderr(): string
    {
        return self::sanitize($this->stderr, $this->secret);
    }

    /** Below this length a password is only removed where it stands as a token of its own. */
    private const SHORT_SECRET = 4;

    /**
     * Removes the password itself and anything shaped like `password=…` / `PGPASSWORD=…` / `MYSQL_PWD=…`. A short
     * password ("ab") is removed only where it stands alone (not inside "table abc"): replacing every occurrence
     * would mangle the message and point at the password.
     */
    public static function sanitize(string $text, ?string $secret = null): string
    {
        // Valid UTF-8 first: the /u pattern below fails (null) on anything else.
        $text = mb_scrub($text, 'UTF-8');
        if ($secret !== null && $secret !== '') {
            $text = mb_strlen($secret) >= self::SHORT_SECRET
                ? str_replace($secret, '***', $text)
                : (string) preg_replace('/(?<!\w)'.preg_quote($secret, '/').'(?!\w)/u', '***', $text);
        }
        // "(using password: YES)" in MySQL's access-denied message says nothing secret and stays readable.
        $text = (string) preg_replace(
            '/\b(PGPASSWORD|MYSQL_PWD|password)(\s*[=:]\s*)(?!(?:YES|NO)\b)("[^"]*"|\'[^\']*\'|\S+)/i',
            '$1$2***',
            $text,
        );

        return trim(mb_scrub($text, 'UTF-8'));
    }

    /**
     * @param  resource  $process
     * @param  array<int, resource>  $pipes
     * @param  (callable(string): void)|null  $onStdout
     * @param  callable(): void  $tick
     * @param  (callable(): ?string)|null  $input
     */
    private function loop($process, array &$pipes, ?callable $onStdout, callable $tick, ?callable $input): int
    {
        $out = $pipes[1] ?? null;
        if ($out !== null) {
            stream_set_blocking($out, false);
        }
        $in = $pipes[0] ?? null;
        if ($in !== null) {
            stream_set_blocking($in, false);
        }
        $pending = '';
        $inputDone = $input === null;

        while (true) {
            if ($in !== null && $pending === '' && $input !== null) {
                $next = $input();
                if ($next === null) {
                    fclose($in); // end of input: from here the client finishes on its own
                    unset($pipes[0]);
                    $in = null;
                    $inputDone = true;
                } else {
                    $pending = $next;
                }
            }

            $read = $out !== null ? [$out] : [];
            $write = $in !== null && $pending !== '' ? [$in] : [];
            if ($read === [] && $write === []) {
                $status = proc_get_status($process);
                if (! $status['running']) {
                    return $this->exitCode($status);
                }
                usleep(10_000);
            } else {
                $except = null;
                if (@stream_select($read, $write, $except, 0, 200_000) === false) {
                    throw new RuntimeException('Lost the connection to the native tool.');
                }

                if ($read !== []) {
                    $taken = 0;
                    while ($taken < self::READ_PER_LOOP) {
                        $data = @fread($out, self::READ_BYTES);
                        if ($data === false && ! feof($out)) {
                            // A broken stream (not a clean end of output) must never pass for a complete dump.
                            // (Windows sockets report the normal end as false + EOF.)
                            throw new RuntimeException('Lost the output of '.basename($this->command->argv[0]).' before it finished.');
                        }
                        if ($data === false || $data === '') {
                            if (feof($out)) {
                                fclose($out);
                                unset($pipes[1]);
                                $out = null;
                            }
                            break;
                        }
                        $taken += strlen($data);
                        if ($onStdout !== null) {
                            $onStdout($data);
                        }
                    }
                }

                if ($write !== []) {
                    $written = @fwrite($in, $pending);
                    if ($written === false) {
                        // The client stopped reading (it failed); its exit code tells why.
                        fclose($in);
                        unset($pipes[0]);
                        $in = null;
                        $pending = '';
                        $inputDone = true;
                    } else {
                        $pending = (string) substr($pending, $written);
                    }
                }
            }

            if (! $inputDone || $input === null) {
                $tick();
            }
        }
    }

    /**
     * Follows the file the tool writes: bounded reads while it runs, the tick in between, and once it has exited (so
     * every write is on disk) a final drain to the end of the file.
     *
     * @param  resource  $process
     * @param  callable(string): void  $onStdout
     * @param  callable(): void  $tick
     */
    private function tail($process, string $file, callable $onStdout, callable $tick): int
    {
        $handle = null;
        $offset = 0;

        try {
            while (true) {
                // The status first: when it says "exited", everything the tool wrote is in the file already.
                $status = proc_get_status($process);
                $running = $status['running'];
                $got = $this->drain($file, $handle, $offset, $onStdout, $running ? self::READ_PER_LOOP : PHP_INT_MAX);

                $tick(); // also after the final drain: a cancel asked for before the dump is accepted still counts
                if (! $running) {
                    return $this->exitCode($status);
                }
                if ($got === 0) {
                    usleep(20_000);
                }
            }
        } finally {
            if (is_resource($handle)) {
                fclose($handle);
            }
        }
    }

    /**
     * Reads what has been appended to the file since $offset, up to $limit bytes, in chunks of READ_BYTES.
     *
     * @param  resource|null  $handle
     * @param  callable(string): void  $onStdout
     */
    private function drain(string $file, &$handle, int &$offset, callable $onStdout, int $limit): int
    {
        if ($handle === null) {
            $opened = is_file($file) ? @fopen($file, 'rb') : false;
            if ($opened === false) {
                return 0; // not created yet
            }
            $handle = $opened;
        }

        $got = 0;
        while ($got < $limit) {
            $data = fread($handle, self::READ_BYTES);
            if ($data === false || $data === '') {
                fseek($handle, $offset); // clears end-of-file, so bytes appended later are read next time

                break;
            }
            $offset += strlen($data);
            $got += strlen($data);
            $onStdout($data);
        }

        return $got;
    }

    /** @param array{signaled: bool, termsig: int, exitcode: int} $status */
    private function exitCode(array $status): int
    {
        if ($status['signaled']) {
            $this->stderr .= "\nterminated by signal ".$status['termsig'];

            return 128 + $status['termsig'];
        }

        return $status['exitcode'];
    }

    /** @param array<int, resource> $pipes */
    private function close(array &$pipes): void
    {
        foreach ($pipes as $key => $pipe) {
            if (is_resource($pipe)) {
                @fclose($pipe);
            }
            unset($pipes[$key]);
        }
    }

    private function readStderr(string $path): void
    {
        $size = (int) @filesize($path);
        $handle = @fopen($path, 'rb');
        if ($handle !== false) {
            fseek($handle, max(0, $size - self::STDERR_BYTES));
            // A note added while running (a signal) goes after what the tool wrote.
            $this->stderr = substr(stream_get_contents($handle).$this->stderr, -self::STDERR_BYTES);
            fclose($handle);
        }
        @unlink($path);
    }
}
