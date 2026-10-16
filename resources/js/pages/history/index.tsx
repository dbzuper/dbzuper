import { Head, router } from '@inertiajs/react';
import { useState } from 'react';
import { HistoryList } from '@/components/history/history-list';
import type { HistoryEntry } from '@/lib/history-api';

const OPEN_FAILED = 'Could not open that entry in the workspace.';

export default function HistoryIndex({
    connections,
}: {
    connections: { id: number; name: string }[];
}) {
    const [problem, setProblem] = useState<string | null>(null);

    const open = (e: HistoryEntry) => {
        setProblem(null);
        if (!e.connection) {
            setProblem(OPEN_FAILED);
            return;
        }
        router.visit(`/c/${e.connection.id}?history=${e.id}`, {
            onError: () => setProblem(OPEN_FAILED),
        });
    };

    return (
        <>
            <Head title="History" />
            <div className="flex h-[calc(100dvh-8rem)] flex-col gap-2 p-4">
                {problem && (
                    <p role="alert" className="text-sm text-destructive">
                        {problem}
                    </p>
                )}
                <div className="min-h-0 flex-1 rounded-lg border">
                    <HistoryList
                        connectionId={null}
                        connections={connections}
                        onOpen={open}
                    />
                </div>
            </div>
        </>
    );
}

HistoryIndex.layout = {
    breadcrumbs: [{ title: 'History', href: '/history' }],
};
