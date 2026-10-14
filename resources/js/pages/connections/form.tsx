import { ConnectionForm } from '@/components/connections/connection-form';
import AppLayout from '@/layouts/app-layout';
import type { ConnectionSummary, DriverChoice } from '@/types/connection';
import { Head } from '@inertiajs/react';

export default function ConnectionFormPage({
    connection,
    drivers,
}: {
    connection: ConnectionSummary | null;
    drivers: DriverChoice[];
}) {
    const title = connection ? `Edit ${connection.name}` : 'New connection';

    return (
        <AppLayout
            breadcrumbs={[
                { title: 'Connections', href: '/connections' },
                { title, href: '#' },
            ]}
        >
            <Head title={title} />
            <div className="p-6">
                <h1 className="mb-6 text-xl font-semibold tracking-tight">
                    {title}
                </h1>
                <ConnectionForm connection={connection} drivers={drivers} />
            </div>
        </AppLayout>
    );
}
