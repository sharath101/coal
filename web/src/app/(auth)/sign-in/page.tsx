'use client';

import { signIn } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';

export default function SignInPage() {
  const t = useTranslations('signIn');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const mutation = useMutation({
    mutationFn: () => api(signIn, { body: { name } }),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(queryKeys.me, user);
      router.replace('/dashboard');
    },
  });

  return (
    <Card>
      <form
        className="grid gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('intro')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">{t('name')}</Label>
            <Input
              id="name"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <ProblemMessage error={mutation.error} />
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          <Button type="submit" disabled={mutation.isPending || name.trim() === ''}>
            {t('submit')}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t('noAccount')}{' '}
            <Link href="/sign-up" className="text-foreground underline underline-offset-4">
              {t('createAccount')}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
