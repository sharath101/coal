'use client';

import { signUp } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PositionFields } from '@/components/position-fields';
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
import { useProductLines, useRoles } from '@/lib/queries';

export default function SignUpPage() {
  const t = useTranslations('signUp');
  const router = useRouter();
  const queryClient = useQueryClient();
  const roles = useRoles();
  const productLines = useProductLines();
  const [name, setName] = useState('');
  const [positionKey, setPositionKey] = useState('');
  const [productLineId, setProductLineId] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api(signUp, { body: { name, positionKey, productLineId: productLineId || undefined } }),
    onSuccess: () => {
      // The sign-up answer lacks what only `GET /me` adds, so the app asks again.
      queryClient.clear();
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
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('nameHint')}</p>
          </div>
          {roles.data && productLines.data && (
            <PositionFields
              roles={roles.data}
              productLines={productLines.data}
              positionKey={positionKey}
              productLineId={productLineId}
              onPositionChange={setPositionKey}
              onProductLineChange={setProductLineId}
            />
          )}
          <ProblemMessage error={mutation.error ?? roles.error ?? productLines.error} />
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          <Button type="submit" disabled={mutation.isPending || !positionKey}>
            {t('submit')}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t('haveAccount')}{' '}
            <Link href="/sign-in" className="text-foreground underline underline-offset-4">
              {t('signIn')}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
