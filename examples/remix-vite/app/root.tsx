import './globals.css';

import { Links, Meta, NavLink, Outlet, Scripts, ScrollRestoration, useNavigate } from '@remix-run/react';
import { useCallback } from 'react';
import { $path } from 'remix-routes';

import { Button } from '~/components/ui/button.tsx';
import { Toaster } from '~/components/ui/toaster.tsx';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '~/components/ui/tooltip.tsx';
import { useToast } from '~/components/ui/use-toast.ts';
import { cn } from '~/utils.ts';
import type { RouterOutputs } from '~app';
import { ctx } from '~app';

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <AppContainer />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

const AppContainer = () => {
  const navigate = useNavigate();
  const linkClass = useCallback(
    ({ isActive }: any) => (isActive ? 'opacity-100 cursor-default' : 'hover:opacity-100 opacity-60'),
    [],
  );

  return (
    <>
      <TooltipProvider>
        <div className="border-b flex">
          <nav className="border-b flex items-center gap-6 py-4 px-6 flex-1">
            <NavLink to="/" className={linkClass} end>
              Home
            </NavLink>

            <NavLink to={$path('/articles')} className={linkClass}>
              Articles
            </NavLink>

            <NavLink to={$path('/wait')} className={linkClass}>
              Waiter
            </NavLink>
          </nav>

          <nav className="flex items-center gap-4 py-4 px-6">
            <AddArticleButton onSuccess={({ id }) => navigate($path('/articles/:articleId/edit', { articleId: id }))} />
            <LoginButton />
            <LogoutButton />
          </nav>
        </div>

        <Outlet />
      </TooltipProvider>

      <Toaster />
    </>
  );
};

const AddArticleButton = ({ onSuccess }: { onSuccess?: (article: RouterOutputs['articles']['create']) => void }) => {
  const { toast } = useToast();

  const { data } = ctx.trpc.auth.me.useQuery();
  const isLoggedIn = !!data;

  const mut = ctx.trpc.articles.create.useMutation({
    onSuccess: () => ctx.trpc.articles.list.invalidate(),
  });

  const buttonElem = (
    <Button
      size="sm"
      disabled={!isLoggedIn || mut.isPending}
      className={cn(!isLoggedIn && 'pointer-events-none')}
      onClick={async () => {
        try {
          const article = await mut.mutateAsync({
            title: 'Your new article',
            body: 'Write something awesome...',
          });

          if (onSuccess) onSuccess(article);

          toast({
            description: 'Article created',
          });
        } catch (e: any) {
          toast({
            title: 'Error',
            description: e.message,
            variant: 'destructive',
          });
        }
      }}
    >
      Add Article
    </Button>
  );

  if (isLoggedIn) return buttonElem;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{buttonElem}</span>
      </TooltipTrigger>
      <TooltipContent>
        <p>You must login to create an article</p>
      </TooltipContent>
    </Tooltip>
  );
};

const LoginButton = () => {
  const { data, isLoading } = ctx.trpc.auth.me.useQuery();
  const login = ctx.trpc.auth.login.useMutation({
    onSuccess: () => {
      // invalidate the entire query cache on login/logout
      return ctx.trpc.$invalidate();
    },
  });

  if (data || isLoading) return null;

  return (
    <Button
      size="sm"
      disabled={login.isPending}
      onClick={async () => {
        try {
          await login.mutateAsync({
            username: 'marc',
            password: 'password',
          });
        } catch (e: any) {
          alert(`Error: ${e.message}`);
        }
      }}
    >
      {login.isPending ? 'Logging in...' : 'Login'}
    </Button>
  );
};

const LogoutButton = () => {
  const { data } = ctx.trpc.auth.me.useQuery();
  const logout = ctx.trpc.auth.logout.useMutation({
    onSuccess: () => {
      // invalidate the entire query cache on login/logout
      return ctx.trpc.$invalidate();
    },
  });

  if (!data) {
    return null;
  }

  return (
    <Button
      size="sm"
      disabled={logout.isPending}
      variant="secondary"
      onClick={async () => {
        try {
          await logout.mutateAsync();

          // invalidate the entire query cache on login/logout
          void ctx.trpc.$invalidate();
        } catch (e: any) {
          alert(`Error: ${e.message}`);
        }
      }}
    >
      {logout.isPending ? 'Logging out...' : `Hi ${data.username} - Logout`}
    </Button>
  );
};
