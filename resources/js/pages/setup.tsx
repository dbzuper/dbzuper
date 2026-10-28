import { Head, useForm } from '@inertiajs/react';
import type { FormEvent } from 'react';
import InputError from '@/components/input-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AuthLayout from '@/layouts/auth-layout';

const labels = {
    name: 'Name',
    email: 'Email',
    password: 'Password',
    password_confirmation: 'Confirm password',
} as const;

export default function Setup() {
    const form = useForm({
        setup_code: '',
        name: '',
        email: '',
        password: '',
        password_confirmation: '',
    });

    const submit = (e: FormEvent) => {
        e.preventDefault();
        form.post('/setup', {
            onFinish: () => form.reset('password', 'password_confirmation'),
        });
    };

    return (
        <AuthLayout
            title="Welcome to DBZuper"
            description="Create the administrator account for this installation."
        >
            <Head title="Setup" />
            <form onSubmit={submit} className="flex flex-col gap-5">
                <div className="grid gap-2">
                    <Label htmlFor="setup_code">Setup code</Label>
                    <Input
                        id="setup_code"
                        value={form.data.setup_code}
                        onChange={(e) =>
                            form.setData('setup_code', e.target.value)
                        }
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="XXXX-XXXX-XXXX"
                        aria-describedby="setup_code_hint"
                        className="font-mono uppercase"
                        required
                    />
                    <p
                        id="setup_code_hint"
                        className="text-xs text-muted-foreground"
                    >
                        Printed in the server log when DBZuper starts (
                        <code>docker compose logs app</code>), or run{' '}
                        <code>php artisan dbzuper:setup-code</code>.
                    </p>
                    <InputError message={form.errors.setup_code} />
                </div>
                {(
                    [
                        'name',
                        'email',
                        'password',
                        'password_confirmation',
                    ] as const
                ).map((field) => (
                    <div key={field} className="grid gap-2">
                        <Label htmlFor={field}>{labels[field]}</Label>
                        <Input
                            id={field}
                            type={
                                field.startsWith('password')
                                    ? 'password'
                                    : field === 'email'
                                      ? 'email'
                                      : 'text'
                            }
                            value={form.data[field]}
                            onChange={(e) =>
                                form.setData(field, e.target.value)
                            }
                            autoComplete={
                                field.startsWith('password')
                                    ? 'new-password'
                                    : field
                            }
                            required
                        />
                        <InputError message={form.errors[field]} />
                    </div>
                ))}
                <Button type="submit" disabled={form.processing}>
                    Create administrator
                </Button>
            </form>
        </AuthLayout>
    );
}
