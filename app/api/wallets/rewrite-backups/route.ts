// POST /api/wallets/rewrite-backups   idempotent: restore files from wallets.csv lines, add CSV lines for files that lack one
import { fail, ok } from "@/lib/http"
import { rewriteBackups } from "@/lib/wallets"

export async function POST() {
  try { return ok(rewriteBackups()) } catch (e) { return fail(e) }
}
