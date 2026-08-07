import { redirect } from 'next/navigation';

// proxy.ts already redirects unauthenticated requests away from every
// non-/login route (including this one) before this component ever renders,
// so reaching here means a session exists. There's no dashboard-at-root
// concept in this product -- /applications is the one home screen -- so this
// route is just a redirect, not a page.
export default function RootPage() {
  redirect('/applications');
}
