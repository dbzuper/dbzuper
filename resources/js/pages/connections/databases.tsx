import type { ConnectionSummary } from '@/types/connection';

export default function Databases({
    connection,
}: {
    connection: ConnectionSummary;
}) {
    return <h1>{connection.name}</h1>;
}
