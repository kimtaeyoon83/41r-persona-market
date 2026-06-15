// /me/analyses → /console redirect stub (Console Sprint 1).
//
// The flat scan-card grid this page used to render is superseded by
// the site-grouped Founder Console. Kept as a redirect so bookmarks
// and any stale "My Analyses" links keep working — same pattern as
// app/validator/page.tsx after the Phase 4 IA cleanup.

import { redirect } from "next/navigation";

export default function MyAnalysesRedirect() {
  redirect("/console");
}
