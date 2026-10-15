import { useEffect, useRef } from 'react';
import type { SchemaSnapshot } from '@/types/schema';
import { useWorkspace } from '@/universe/store';
import { useRecords } from './records-store';
import { emptyTrail } from './trail';
import { decodeTrail, encodeTrail } from './url-state';

const PARAM = 'r';
const MAX_ENCODED = 16 * 1024;

export const TRAIL_TOO_LONG_NOTICE = 'Trail is too long to keep in the URL';

export const droppedNotice = (n: number) =>
    n === 1
        ? '1 record from the link is no longer in the schema and was skipped.'
        : `${n} records from the link are no longer in the schema and were skipped.`;

const currentParam = () =>
    new URL(window.location.href).searchParams.get(PARAM);

/** Sets or removes `r`, keeping the other params, the hash and the existing history.state (Inertia's page). */
function writeParam(value: string | null, mode: 'push' | 'replace') {
    const url = new URL(window.location.href);
    if (value === null) url.searchParams.delete(PARAM);
    else url.searchParams.set(PARAM, value);
    const next = url.pathname + url.search + url.hash;
    if (mode === 'push')
        window.history.pushState(window.history.state, '', next);
    else window.history.replaceState(window.history.state, '', next);
}

/**
 * Keeps the exploration trail in `?r=`: restores it on mount, pushes one history entry per
 * user-driven change of the encoded trail, and restores it again on back/forward.
 */
export function useTrailUrl(snapshot: SchemaSnapshot | null) {
    const snapshotRef = useRef(snapshot);
    snapshotRef.current = snapshot;
    // True while a URL-driven setTrail/reset runs, so the store subscription does not write back.
    const applying = useRef(false);
    const restored = useRef(false);

    const apply = (source: 'mount' | 'popstate') => {
        const snap = snapshotRef.current;
        if (!snap) return;
        const records = useRecords.getState();
        const raw = currentParam();
        if (raw === null) {
            if (source === 'popstate') {
                applying.current = true;
                try {
                    // Not reset(): that would also forget the connection.
                    records.setTrail(emptyTrail());
                } finally {
                    applying.current = false;
                }
            }
            return;
        }
        const decoded = decodeTrail(raw, snap);
        if (!decoded || decoded.trail.nodes.length === 0) {
            // Hostile, oversized, stale or empty: ignore and remove.
            writeParam(null, 'replace');
            if (decoded && decoded.dropped > 0)
                useRecords.setState({ notice: droppedNotice(decoded.dropped) });
            return;
        }
        applying.current = true;
        try {
            records.setTrail(decoded.trail);
        } finally {
            applying.current = false;
        }
        useWorkspace.getState().setView('records');
        if (decoded.dropped > 0)
            useRecords.setState({ notice: droppedNotice(decoded.dropped) });
        const normalized = encodeTrail(decoded.trail, primaryKeys(snap));
        if (normalized !== raw) writeParam(normalized, 'replace');
    };
    const applyRef = useRef(apply);
    applyRef.current = apply;

    useEffect(() => {
        if (!snapshot || restored.current) return;
        restored.current = true;
        applyRef.current('mount');
    }, [snapshot]);

    useEffect(() => {
        const unsubscribe = useRecords.subscribe((state, prev) => {
            const snap = snapshotRef.current;
            if (!snap || applying.current || state.trail === prev.trail) return;
            const encoded =
                state.trail.nodes.length === 0
                    ? null
                    : encodeTrail(state.trail, primaryKeys(snap));
            if (encoded === currentParam()) return;
            if (encoded !== null && encoded.length > MAX_ENCODED) {
                if (state.notice !== TRAIL_TOO_LONG_NOTICE)
                    useRecords.setState({ notice: TRAIL_TOO_LONG_NOTICE });
                return;
            }
            writeParam(encoded, 'push');
        });
        const onPopState = () => applyRef.current('popstate');
        window.addEventListener('popstate', onPopState);
        return () => {
            unsubscribe();
            window.removeEventListener('popstate', onPopState);
        };
    }, []);
}

const primaryKeys = (snap: SchemaSnapshot) => (table: string) =>
    snap.tables.find((t) => t.name === table)?.primary_key ?? null;
