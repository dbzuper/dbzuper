<?php

namespace App\Transfers\Native;

use Illuminate\Database\Connection;
use Throwable;

/**
 * Can this MySQL/MariaDB login dump the database's routines and events? mysqldump fails (or writes empty bodies)
 * when it can't, so a native "All" export leaves them out and says so instead (spec §2 "Native export").
 */
final class MySqlPrivilegeProbe
{
    public const ROUTINES_GAP = 'stored procedures and functions (no permission)';

    public const EVENTS_GAP = 'events (no permission)';

    /**
     * Routines: false when the login sees a routine without its body (it has EXECUTE but not SHOW_ROUTINE / SHOW
     * CREATE ROUTINE, and isn't the definer). Events: false when SHOW EVENTS is refused.
     *
     * @return array{routines: bool, events: bool}
     */
    public static function check(Connection $db, string $database): array
    {
        $hidden = $db->selectOne(
            'SELECT COUNT(*) AS n FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_DEFINITION IS NULL',
            [$database],
        );

        try {
            $db->select('SHOW EVENTS FROM `'.str_replace('`', '``', $database).'`');
            $events = true;
        } catch (Throwable) {
            $events = false;
        }

        return ['routines' => (int) ($hidden->n ?? 0) === 0, 'events' => $events];
    }

    /**
     * @param  array{routines: bool, events: bool}  $access
     * @return list<string> the dump header's "Not included" entries for what the login can't read
     */
    public static function gaps(array $access): array
    {
        $gaps = [];
        if (! $access['routines']) {
            $gaps[] = self::ROUTINES_GAP;
        }
        if (! $access['events']) {
            $gaps[] = self::EVENTS_GAP;
        }

        return $gaps;
    }
}
