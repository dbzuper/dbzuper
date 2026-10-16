import { useEffect, useRef } from 'react';
import type { SchemaSnapshot } from '@/types/schema';
import { useBrowse } from '@/browse/browse-store';
import { recordsTabTitle } from './open-record';
import { useRecords } from './records-store';
import { emptyTrail } from './trail';
import { setPopstateHandler } from './popstate-guard';
import { decodeTrail, encodeTrail, MAX_PUSHED_PARAM } from './url-state';

const PARAM = 'r';
const TAG = 'dbsTrail';

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
    // Tag the entry as ours; Inertia's own state stays in the merge.
    const state = {
        ...(window.history.state as object | null),
        [TAG]: url.pathname,
    };
    if (mode === 'push') window.history.pushState(state, '', next);
    else window.history.replaceState(state, '', next);
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
    // The pathname this hook serves; kept current across renders (Inertia navigations re-render).
    const pathRef = useRef(window.location.pathname);
    pathRef.current = window.location.pathname;

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
            // No trail, no records tab (one may linger from storage or an earlier entry).
            if (records.connectionId !== null)
                useBrowse.getState().closeRecords(records.connectionId);
            return;
        }
        const decoded = decodeTrail(raw, snap);
        if (!decoded || decoded.trail.nodes.length === 0) {
            // Hostile, oversized, stale or empty: ignore and remove.
            writeParam(null, 'replace');
            if (decoded && decoded.dropped > 0)
                useRecords.setState({
                    notice: droppedNotice(decoded.dropped),
                    noticeTable: null,
                });
            return;
        }
        applying.current = true;
        try {
            records.setTrail(decoded.trail);
        } finally {
            applying.current = false;
        }
        const root = decoded.trail.nodes[0];
        if (records.connectionId !== null)
            useBrowse
                .getState()
                .showRecords(records.connectionId, recordsTabTitle(root));
        if (decoded.dropped > 0)
            useRecords.setState({
                notice: droppedNotice(decoded.dropped),
                noticeTable: null,
            });
        const normalized = encodeTrail(decoded.trail, primaryKeys(snap));
        // On mount this also tags the original entry as ours (Inertia's state is merged, not replaced).
        if (source === 'mount' || normalized !== raw)
            writeParam(normalized, 'replace');
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
            if (encoded !== null && encoded.length > MAX_PUSHED_PARAM) {
                if (state.notice !== TRAIL_TOO_LONG_NOTICE)
                    useRecords.setState({
                        notice: TRAIL_TOO_LONG_NOTICE,
                        noticeTable: null,
                    });
                return;
            }
            writeParam(
                encoded,
                state.systemEpoch !== prev.systemEpoch ? 'replace' : 'push',
            );
        });
        // Closing the records tab ends the exploration: the trail empties, so `?r=` goes too.
        const unsubscribeTabs = useBrowse.subscribe((state, prev) => {
            const records = useRecords.getState();
            const c = records.connectionId;
            if (c === null || records.trail.nodes.length === 0) return;
            const hasRecords = (s: typeof state) =>
                s.byConnection[c]?.tabs.some((t) => t.kind === 'records') ??
                false;
            if (hasRecords(prev) && !hasRecords(state))
                records.setTrail(emptyTrail());
        });
        // Entries of this workspace (same pathname, or tagged by us) are applied here; the
        // popstate guard keeps Inertia from re-mounting the page for them.
        setPopstateHandler((event) => {
            const tag = (event.state as Record<string, unknown> | null)?.[TAG];
            const path = window.location.pathname;
            if (path !== pathRef.current || (tag !== undefined && tag !== path))
                return false;
            applyRef.current('popstate');
            return true;
        });
        return () => {
            unsubscribe();
            unsubscribeTabs();
            setPopstateHandler(null);
        };
    }, []);
}

const primaryKeys = (snap: SchemaSnapshot) => (table: string) =>
    snap.tables.find((t) => t.name === table)?.primary_key ?? null;
