'use client';

import { updateMe, type Me } from '@coal/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ProblemMessage } from '@/components/problem-message';
import { RoleFields } from '@/components/role-fields';
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
import { queryKeys, useMe, useProductLines, useRoles } from '@/lib/queries';

function ProfileForm({ me, saved, onSaved }: { me: Me; saved: boolean; onSaved: () => void }) {
  const t = useTranslations('profile');
  const tSignUp = useTranslations('signUp');
  const queryClient = useQueryClient();
  const roles = useRoles();
  const productLines = useProductLines();
  const [name, setName] = useState(me.name);
  const [roleKey, setRoleKey] = useState(me.role.key);
  const [productLineId, setProductLineId] = useState(me.productLine?.id ?? '');

  const changes = {
    ...(name.trim() !== me.name && { name }),
    ...(roleKey !== me.role.key && { roleKey }),
    ...(productLineId !== (me.productLine?.id ?? '') && { productLineId: productLineId || null }),
  };
  const changed = Object.keys(changes).length > 0;

  const mutation = useMutation({
    mutationFn: () => api(updateMe, { body: changes, ifMatch: me.updatedAt }),
    onSuccess: (updated) => {
      onSaved();
      queryClient.setQueryData(queryKeys.me, updated);
    },
  });

  return (
    <Card>
      <form
        className="grid gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) mutation.mutate();
        }}
      >
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('intro')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">{tSignUp('name')}</Label>
            <Input
              id="name"
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {roles.data && productLines.data && (
            <RoleFields
              roles={roles.data}
              productLines={productLines.data}
              roleKey={roleKey}
              productLineId={productLineId}
              onRoleChange={setRoleKey}
              onProductLineChange={setProductLineId}
            />
          )}
          <ProblemMessage error={mutation.error} />
          {saved && !changed && <p className="text-sm text-muted-foreground">{t('saved')}</p>}
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={!changed || mutation.isPending}>
            {t('save')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function ProfilePage() {
  const { data: me } = useMe();
  const [saved, setSaved] = useState(false);
  if (!me) return null;
  return (
    <div className="mx-auto w-full max-w-md p-6">
      {/* Re-mount when the profile changes, so the form starts from the saved values. */}
      <ProfileForm key={me.updatedAt} me={me} saved={saved} onSaved={() => setSaved(true)} />
    </div>
  );
}
