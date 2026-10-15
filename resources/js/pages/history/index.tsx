import { Head, router } from '@inertiajs/react';
import { HistoryList } from '@/components/history/history-list';
import AppLayout from '@/layouts/app-layout';

export default function HistoryIndex({
    connections,
}: {
    connections: { id: number; name: string }[];
}) {
    return (
        <AppLayout breadcrumbs={[{ title: 'History', href: '/history' }]}>
            <Head title="History" />
            <div className="h-[calc(100dvh-8rem)] p-4">
                <div className="h-full rounded-lg border">
                    <HistoryList
                        connectionId={null}
                        connections={connections}
                        onOpen={(e) =>
                            e.connection &&
                            router.visit(
                                `/c/${e.connection.id}?sql=${encodeURIComponent(e.sql)}`,
                            )
                        }
                    />
                </div>
            </div>
        </AppLayout>
    );
}
