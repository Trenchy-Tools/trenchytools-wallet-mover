"use client"

import * as React from "react"
import { ApiErrorBox } from "./api-error"
import { useStatus } from "./providers"
import { Button } from "./ui/button"
import { Badge } from "./ui/card"
import { Field, Input, Select } from "./ui/input"
import { Sheet } from "./ui/sheet"
import { DEMO, DEMO_KEY_LABEL } from "@/lib/browser/demo"
import { api, type StatusView, type TransferVenues } from "@/lib/client"
import { MODES, ROUTES } from "@/lib/chains"

/**
 * API key (+ Connected check), API URL under Advanced, gas reserves, default route / mode / venue, backup folder (read-only).
 * Demo mode: the visitor's own key (created in this browser on the first visit, shown masked, replaceable by pasting or
 * "Create a new key"; a refusal is shown exactly as the API sent it), everything saved in this browser.
 */
export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { status, refresh } = useStatus()
  const [apiKey, setApiKey] = React.useState("")
  const [form, setForm] = React.useState<Partial<StatusView>>({})
  const [venues, setVenues] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)
  const [saved, setSaved] = React.useState(false)

  React.useEffect(() => { if (open && status) setForm({ apiUrl: status.apiUrl, gasReserveSol: status.gasReserveSol, gasReserveEth: status.gasReserveEth, route: status.route, mode: status.mode, venue: status.venue }) }, [open, status])
  React.useEffect(() => { if (open) api<TransferVenues>("/api/transfer/venues").then((v) => setVenues(Object.keys(v.venues))).catch(() => setVenues([])) }, [open])

  const save = async () => {
    setBusy(true); setError(null); setSaved(false)
    try {
      await api<StatusView>("/api/settings", { method: "PATCH", json: { ...(apiKey ? { apiKey } : {}), ...(DEMO ? {} : { apiUrl: form.apiUrl ?? null }), gasReserveSol: form.gasReserveSol, gasReserveEth: form.gasReserveEth, route: form.route, mode: form.mode, venue: form.venue } })
      setApiKey(""); setSaved(true)
      await refresh()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  const clearKey = async () => {
    setBusy(true); setError(null)
    try { await api("/api/settings", { method: "PATCH", json: { apiKey: null } }); await refresh() } catch (e) { setError(e) } finally { setBusy(false) }
  }
  const createKey = async () => {
    setBusy(true); setError(null)
    try { await api("/api/settings", { method: "PATCH", json: { createKey: true } }); await refresh() } catch (e) { setError(e) } finally { setBusy(false) }
  }
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v))

  return (
    <Sheet open={open} onClose={onClose} title="Settings" description={DEMO ? "Saved in this browser. Your API key was made for you on your first visit; it is yours alone." : "Saved to _app/wallet-mover/settings.json in the wallet folder; .env provides the defaults."}>
      <div className="flex flex-col gap-4 text-sm">
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-medium">API key</span>
            {status && <Badge tone={status.connected ? "ok" : status.apiKeySet ? "bad" : "warn"}>{status.connected ? `Connected · ${status.keyPrefix}` : status.apiKeySet ? "Not accepted" : "Missing"}</Badge>}
          </div>
          <Input type="password" placeholder={status?.apiKeySet ? (DEMO ? "your key is kept in this browser; paste another to replace it" : `key set (from ${status.apiKeyFrom}); paste to replace`) : "paste your key"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
          {DEMO ? (
            <p className="text-muted-foreground text-xs">
              <button className="underline" onClick={createKey} disabled={busy} title={`GET /api/create-api-key?label=${DEMO_KEY_LABEL}`}>Create a new key</button>
              {status?.apiKeySet && <> · <button className="underline" onClick={clearKey} disabled={busy}>forget this key</button></>}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              No key yet? One call, no account: <code className="break-all">curl &quot;{status?.apiUrl ?? "https://api.trenchy.tools"}/api/create-api-key?label=wallet-mover&quot;</code>
              {status?.apiKeyFrom === "settings" && <> · <button className="underline" onClick={clearKey}>clear the saved key</button></>}
            </p>
          )}
          {status?.error && <ApiErrorBox error={{ ...status.error, status: 0 }} />}
          {DEMO && status?.keyError && !status.apiKeySet && (
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Creating your key failed. The API said:</span>
              <ApiErrorBox error={{ ...status.keyError, status: status.keyError.status ?? 0 }} />
              <span className="text-muted-foreground text-xs">Paste a key you already have above, or try again later.</span>
            </div>
          )}
        </section>

        <section className="grid grid-cols-2 gap-3">
          <Field label="Gas reserve · SOL"><Input type="number" step="0.0001" min="0" value={form.gasReserveSol ?? ""} onChange={(e) => setForm({ ...form, gasReserveSol: num(e.target.value) })} /></Field>
          <Field label="Gas reserve · ETH (RH)"><Input type="number" step="0.00001" min="0" value={form.gasReserveEth ?? ""} onChange={(e) => setForm({ ...form, gasReserveEth: num(e.target.value) })} /></Field>
          <Field label="Default route">
            <Select value={form.route ?? "direct"} onChange={(e) => setForm({ ...form, route: e.target.value as StatusView["route"] })}>{ROUTES.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
          </Field>
          <Field label="Default mode">
            <Select value={form.mode ?? "float"} onChange={(e) => setForm({ ...form, mode: e.target.value as StatusView["mode"] })}>{MODES.map((m) => <option key={m} value={m}>{m}</option>)}</Select>
          </Field>
          <Field label="Default venue" className="col-span-2">
            <Select value={form.venue ?? "auto"} onChange={(e) => setForm({ ...form, venue: e.target.value })}>
              {["auto", "random", ...venues].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </Field>
        </section>

        {!DEMO && (
          <details className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium">Advanced</summary>
            <Field label="API URL" className="mt-2"><Input value={form.apiUrl ?? ""} onChange={(e) => setForm({ ...form, apiUrl: e.target.value })} placeholder="https://api.trenchy.tools" /></Field>
          </details>
        )}

        {DEMO ? (
          <Field label="Keys (every wallet lives in this browser only; Download backup saves them as a file, clearing this site's data deletes them)">
            <code className="bg-muted rounded-md px-2 py-1.5 text-xs break-all">{status?.backupDir ?? "…"} (localStorage)</code>
          </Field>
        ) : (
          <Field label="Backup folder (read-only; set WALLET_BACKUP_DIR in .env to move it)">
            <code className="bg-muted rounded-md px-2 py-1.5 text-xs break-all">{status?.backupDir ?? "…"}</code>
          </Field>
        )}

        <ApiErrorBox error={error} />
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          {saved && <span className="text-muted-foreground text-xs">saved</span>}
        </div>
      </div>
    </Sheet>
  )
}
