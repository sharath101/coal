import { NextResponse, type NextRequest } from 'next/server';

/**
 * Sends people without a session to sign in. A convenience only: the backend enforces every
 * rule (docs/README.md#principles).
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has('coal_session')) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = '/sign-in';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/workstation/:path*',
    '/profile/:path*',
    '/projects/:path*',
    '/tasks/:path*',
    '/templates/:path*',
  ],
};
