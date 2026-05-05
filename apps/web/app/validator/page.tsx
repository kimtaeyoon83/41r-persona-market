import { redirect } from "next/navigation";

// Phase 4 IA cleanup — `/validator` was a duplicate entry point for
// `/`. The Mode A/B toggle now lives on the homepage; this stub
// keeps bookmarks + legacy "Verify Mode B" links working.
export default function ValidatorRedirect() {
  redirect("/");
}
