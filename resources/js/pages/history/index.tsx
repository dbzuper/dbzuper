import { Head } from '@inertiajs/react';
import AppLayout from '@/layouts/app-layout';

export default function HistoryIndex() {
    return (
        <AppLayout breadcrumbs={[{ title: 'History', href: '/history' }]}>
            <Head title="History" />
            <div className="p-6 text-sm text-muted-foreground">
                Query history
            </div>
        </AppLayout>
    );
}
