import { apiFetch } from '@/lib/http';

/** One database on a server; counts and sizes are null when the server didn't say. */
export type DatabaseEntry = {
    name: string;
    system: boolean;
    tables: number | null;
    bytes: number | null;
    /** False when the name can't be used in a connection, so it can't be opened. */
    openable: boolean;
};

export type DatabaseList = {
    databases: DatabaseEntry[];
    last_database: string | null;
};

export const databasesApi = {
    list: (connectionId: number) =>
        apiFetch<DatabaseList>(`/api/c/${connectionId}/databases`),
};

const SYSTEM_KEY = 'dbsuperb.show-system-databases';

/** Whether this viewer asked to see system databases (remembered per browser). */
export function readShowSystem(storage: Pick<Storage, 'getItem'>): boolean {
    return storage.getItem(SYSTEM_KEY) === '1';
}

export function writeShowSystem(
    storage: Pick<Storage, 'setItem'>,
    show: boolean,
): void {
    storage.setItem(SYSTEM_KEY, show ? '1' : '0');
}

/** Databases in list order: the last opened one first, then by name; system ones only when asked. */
export function visibleDatabases(
    list: DatabaseList,
    showSystem: boolean,
    query = '',
): DatabaseEntry[] {
    const q = query.trim().toLowerCase();
    return list.databases
        .filter((d) => showSystem || !d.system)
        .filter((d) => q === '' || d.name.toLowerCase().includes(q))
        .sort((a, b) =>
            a.name === list.last_database
                ? -1
                : b.name === list.last_database
                  ? 1
                  : a.name.localeCompare(b.name),
        );
}
