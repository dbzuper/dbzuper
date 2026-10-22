import { create } from "zustand";
import { flushOpenEdits } from "./flush-edits";

/** Which table's Review & commit dialog is open (spec §4.3); one at a time. */
type State = {
    open: { connectionId: number; table: string } | null;
    /** Bumped on every open: the dialog fetches a fresh preview each time (pending changes may have changed). */
    nonce: number;
    /** Stages any open editor's draft first, so the preview includes it. */
    openReview(connectionId: number, table: string): void;
    closeReview(): void;
    /** By pendingKey: tables whose commit is on its way (a schema refresh must not rebuild their changes). */
    committing: Record<string, true>;
    /** By pendingKey: work waiting for that table's commit to finish (the latest wins). */
    deferred: Record<string, () => void>;
    beginCommit(key: string): void;
    /** Clears the flag, then runs what was deferred (after the commit's changes are settled). */
    endCommit(key: string): void;
    /** Runs `fn` once the table's commit ends (now when none is in flight). */
    afterCommit(key: string, fn: () => void): void;
};

const omit = <T>(map: Record<string, T>, key: string): Record<string, T> => {
    const next = { ...map };
    delete next[key];
    return next;
};

export const useReview = create<State>()((set, get) => ({
    open: null,
    nonce: 0,
    committing: {},
    deferred: {},
    beginCommit: (key) =>
        set((s) => ({ committing: { ...s.committing, [key]: true } })),
    endCommit: (key) => {
        const fn = get().deferred[key];
        set((s) => ({
            committing: omit(s.committing, key),
            deferred: omit(s.deferred, key),
        }));
        fn?.();
    },
    afterCommit: (key, fn) => {
        if (!get().committing[key]) fn();
        else set((s) => ({ deferred: { ...s.deferred, [key]: fn } }));
    },
    openReview: (connectionId, table) => {
        flushOpenEdits();
        set((s) => ({ open: { connectionId, table }, nonce: s.nonce + 1 }));
    },
    closeReview: () => set((s) => (s.open ? { open: null } : s)),
}));
