import { Link, router, usePage } from '@inertiajs/react';
import { Laptop, LogOut, Settings } from 'lucide-react';
import {
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { UserInfo } from '@/components/user-info';
import { useMobileNavigation } from '@/hooks/use-mobile-navigation';
import { logout } from '@/routes';
import { edit } from '@/routes/profile';
import type { User } from '@/types';

type Props = {
    user: User;
};

export function UserMenuContent({ user }: Props) {
    const cleanup = useMobileNavigation();
    const automatic = usePage().props.auth.automatic === true;

    const handleLogout = () => {
        cleanup();
        router.flushAll();
    };

    return (
        <>
            <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <UserInfo user={user} showEmail={true} />
                </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                    <Link
                        className="block w-full cursor-pointer"
                        href={edit()}
                        prefetch
                        onClick={cleanup}
                    >
                        <Settings className="mr-2" />
                        Settings
                    </Link>
                </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {automatic ? (
                // Logging out would only sign straight back in, so the menu
                // explains the setting instead.
                <div
                    className="flex items-start gap-2 px-2 py-1.5 text-xs text-muted-foreground"
                    data-test="auto-login-note"
                >
                    <Laptop className="mt-0.5 size-4 shrink-0" />
                    <span>
                        Signed in automatically on this computer
                        (DBZUPER_AUTO_LOGIN).
                    </span>
                </div>
            ) : (
                <DropdownMenuItem asChild>
                    <Link
                        className="block w-full cursor-pointer"
                        href={logout()}
                        as="button"
                        onClick={handleLogout}
                        data-test="logout-button"
                    >
                        <LogOut className="mr-2" />
                        Log out
                    </Link>
                </DropdownMenuItem>
            )}
        </>
    );
}
