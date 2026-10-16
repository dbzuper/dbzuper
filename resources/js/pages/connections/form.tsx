import { ConnectionForm } from '@/components/connections/connection-form';
import type { ConnectionSummary, DriverChoice } from '@/types/connection';
import { Head, setLayoutProps } from '@inertiajs/react';
import { useEffect } from 'react';

export default function ConnectionFormPage({
    connection,
    drivers,
}: {
    connection: ConnectionSummary | null;
    drivers: DriverChoice[];
}) {
    const title = connection ? `Edit ${connection.name}` : 'New connection';

    // The title depends on the connection being edited, so the breadcrumbs are set at runtime.
    useEffect(() => {
        setLayoutProps({
            breadcrumbs: [
                { title: 'Connections', href: '/connections' },
                { title, href: '#' },
            ],
        });
    }, [title]);

    return (
        <>
            <Head title={title} />
            <div className="p-6">
                <h1 className="mb-6 text-xl font-semibold tracking-tight">
                    {title}
                </h1>
                <ConnectionForm connection={connection} drivers={drivers} />
            </div>
        </>
    );
}

ConnectionFormPage.layout = {
    breadcrumbs: [{ title: 'Connections', href: '/connections' }],
};
