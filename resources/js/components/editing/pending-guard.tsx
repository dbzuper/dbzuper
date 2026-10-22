import { useEffect, useState } from 'react';
import { setCloseGuard } from '@/browse/browse-store';
import { usePending } from '@/editing/pending-store';
import { DiscardDialog, type DiscardTarget } from './discard-dialog';

type Ask = {
    connectionId: number;
    targets: DiscardTarget[];
    proceed: () => void;
};

/**
 * Pending changes live in memory for the browser session (spec §4.4): closing the last open view of a table that
 * has some asks before they are discarded, and leaving the page asks the browser's "leave page?" question.
 */
export function PendingGuard() {
    const [ask, setAsk] = useState<Ask | null>(null);

    useEffect(() => {
        setCloseGuard((connectionId, tables, proceed) => {
            const store = usePending.getState();
            const targets = tables.flatMap((table) => {
                const c = store.count(connectionId, table);
                const count = c.inserted + c.updated + c.deleted;
                return count > 0 ? [{ table, count }] : [];
            });
            if (targets.length === 0) return false;
            setAsk({ connectionId, targets, proceed });
            return true;
        });
        return () => setCloseGuard(null);
    }, []);

    const anyPending = usePending((s) => Object.keys(s.byTable).length > 0);
    useEffect(() => {
        if (!anyPending) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            // Older browsers show the prompt only when a return value is set.
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [anyPending]);

    return (
        <DiscardDialog
            targets={ask?.targets ?? null}
            onCancel={() => setAsk(null)}
            onConfirm={() => {
                if (!ask) return;
                setAsk(null);
                for (const t of ask.targets)
                    usePending.getState().discard(ask.connectionId, t.table);
                ask.proceed();
            }}
        />
    );
}
