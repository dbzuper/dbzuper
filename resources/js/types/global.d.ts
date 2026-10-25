import type { Auth } from '@/types/auth';

declare module 'react' {
    interface InputHTMLAttributes<T> {
        passwordrules?: string;
    }
}

declare module '@inertiajs/core' {
    export interface InertiaConfig {
        sharedPageProps: {
            name: string;
            auth: Auth;
            sidebarOpen: boolean;
            sidebar: {
                recentConnections: {
                    id: number;
                    name: string;
                    color: string | null;
                    driver_label: string;
                }[];
                recentQueries: {
                    id: number;
                    connection_id: number;
                    connection_name: string;
                    color: string | null;
                    sql: string;
                    created_at: string;
                }[];
            } | null;
            [key: string]: unknown;
        };
    }
}
