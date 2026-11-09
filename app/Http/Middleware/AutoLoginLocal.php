<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Signs requests from this computer in as the administrator when DBZUPER_AUTO_LOGIN is on, for a private install
 * that only its owner can reach (such as one managed by laman). It runs just before authentication, so the login
 * screen never shows.
 *
 * The setting alone does nothing. Every one of these must hold:
 *
 *  - The web server passes the server variable DBZUPER_AUTO_LOGIN_KEY, whose SHA-256 matches
 *    DBZUPER_AUTO_LOGIN_HASH. Server variables come from the web server's own configuration and a visitor
 *    cannot send one, so copying this .env to another server leaves auto sign-in inert.
 *  - APP_URL is a local address (localhost, a loopback IP, *.test, *.localhost): set by whoever runs the
 *    install, never by the request.
 *  - The request is for a local name too, the raw connection comes from loopback (REMOTE_ADDR, never a
 *    proxy-adjusted IP), any X-Forwarded-For / Forwarded addresses are loopback, and no other client-IP header
 *    (as tunnels and CDNs add) is present.
 */
class AutoLoginLocal
{
    /** Headers that carry a visitor's address through a tunnel, CDN or proxy; a local visit never has them. */
    private const CLIENT_IP_HEADERS = [
        'CF-Connecting-IP', 'True-Client-IP', 'X-Real-IP', 'X-Client-IP', 'Fastly-Client-IP',
        'X-Cluster-Client-IP', 'X-Original-Forwarded-For', 'Forwarded-For',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        if (config('dbzuper.auto_login') && ! Auth::check()) {
            if (self::allowed($request)) {
                // DBZuper has a single administrator: the first account.
                $admin = User::query()->orderBy('id')->first();
                if ($admin !== null) {
                    Auth::login($admin);
                    $request->session()->regenerate();
                    $request->session()->put('auto_login', true);
                    Log::notice('Signed in automatically (DBZUPER_AUTO_LOGIN).', [
                        'user' => $admin->email,
                        'ip' => $request->server->getString('REMOTE_ADDR'),
                    ]);
                }
            } else {
                self::warnRefused($request);
            }
        }

        return $next($request);
    }

    public static function allowed(Request $request): bool
    {
        return self::serverKeyMatches($request) && self::appUrlIsLocal() && self::fromThisComputer($request);
    }

    /** The web server vouches for this install: it passes the key whose hash is configured. */
    public static function serverKeyMatches(Request $request): bool
    {
        $hash = strtolower((string) config('dbzuper.auto_login_hash'));
        $key = $request->server->getString('DBZUPER_AUTO_LOGIN_KEY');

        return preg_match('/^[0-9a-f]{64}$/', $hash) === 1 && strlen($key) >= 32
            && hash_equals($hash, hash('sha256', $key));
    }

    public static function appUrlIsLocal(): bool
    {
        return self::localName((string) parse_url((string) config('app.url'), PHP_URL_HOST));
    }

    public static function fromThisComputer(Request $request): bool
    {
        if (! self::loopback($request->server->getString('REMOTE_ADDR'))) {
            return false;
        }

        foreach (self::CLIENT_IP_HEADERS as $header) {
            if ($request->headers->has($header)) {
                return false;
            }
        }

        $forwarded = array_filter(array_map('trim', explode(',', (string) $request->headers->get('X-Forwarded-For'))));
        foreach (self::forwardedFor((string) $request->headers->get('Forwarded')) as $address) {
            $forwarded[] = $address;
        }
        foreach ($forwarded as $address) {
            if (! self::loopback($address)) {
                return false;
            }
        }

        return self::localName($request->getHost());
    }

    private static function localName(string $host): bool
    {
        $host = strtolower(trim($host, '[]'));

        return $host === 'localhost' || self::loopback($host)
            || str_ends_with($host, '.test') || str_ends_with($host, '.localhost');
    }

    private static function loopback(string $address): bool
    {
        $address = trim($address, ' "[]');
        if (str_starts_with($address, '::ffff:')) {
            $address = substr($address, 7);
        }

        return $address === '::1' || (bool) preg_match('/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/', $address);
    }

    /** @return list<string> the for= addresses of an RFC 7239 Forwarded header */
    private static function forwardedFor(string $header): array
    {
        preg_match_all('/for=("?)\[?([^;,"\]]+)\]?\1/i', $header, $m);

        return array_map(fn (string $a) => preg_replace('/:\d+$/', '', $a) ?? $a, $m[2]);
    }

    /**
     * Auto sign-in is on but this request did not qualify: say so in the log (at most hourly), so a setting left
     * on where it does not belong gets noticed instead of silently ignored.
     */
    private static function warnRefused(Request $request): void
    {
        if (! Cache::add('dbzuper.auto_login.refused', true, now()->addHour())) {
            return;
        }

        $why = match (true) {
            ! self::serverKeyMatches($request) => 'the web server did not pass a matching DBZUPER_AUTO_LOGIN_KEY',
            ! self::appUrlIsLocal() => 'APP_URL is not a local address',
            default => 'the request did not come from this computer',
        };
        Log::warning("DBZUPER_AUTO_LOGIN is on, but a request was refused automatic sign-in: {$why}. "
            .'Turn it off unless this is a private install on your own computer.', [
                'ip' => $request->server->getString('REMOTE_ADDR'),
                'host' => $request->getHost(),
            ]);
    }
}
