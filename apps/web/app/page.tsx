// Phase 1 placeholder — Phase 2 will replace with the Recent Analyses
// feed per the v1.0 decision doc (§8.1). For now, send root visitors
// straight to the Validator entry. The old autotest-era homepage is
// preserved at backup/web/app/old-homepage.tsx.

import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/validator');
}
