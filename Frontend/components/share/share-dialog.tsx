"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Link2, Lock, Globe, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { getJson, postJson } from "@/lib/auth-api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccessLevelSelect, type AccessLevel } from "@/components/share/access-level-select";

type SharingState = {
  members: { user_id: string; email: string; first_name: string; last_name: string; role: string }[];
  links: { id: string; slug: string; role: "viewer" | "editor"; visibility: "public" | "password"; revoked_at: string | null }[];
};

export function ShareDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  projectName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<SharingState | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AccessLevel>("viewer");

  const [linkRole, setLinkRole] = useState<AccessLevel>("viewer");
  const [privatePassword, setPrivatePassword] = useState("");

  const publicLink = useMemo(() => state?.links.find((l) => l.visibility === "public" && !l.revoked_at) ?? null, [state]);
  const privateLink = useMemo(
    () => state?.links.find((l) => l.visibility === "password" && !l.revoked_at) ?? null,
    [state]
  );

  async function refresh() {
    setLoading(true);
    try {
      const res = await getJson<SharingState>(`/api/projects/${projectId}/sharing`);
      setState(res);
    } catch (e: any) {
      toast.error(e?.detail ?? e?.message ?? "Could not load sharing.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      setState(null);
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const makeShareUrl = (slug: string) => `${origin}/share/${slug}`;
  const makeInviteUrl = (token: string) => `${origin}/invite/${token}`;

  async function copy(text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(okMsg);
    } catch {
      toast.error("Could not copy.");
    }
  }

  function isValidEmail(s: string) {
    // Lightweight check; server also validates with zod.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  async function upsertShareLink(visibility: "public" | "password", password?: string) {
    const res = await fetch(`/api/projects/${projectId}/sharing`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: linkRole, visibility, ...(password ? { password } : {}) }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.detail ?? "Request failed.");
    }
  }

  async function revokeShareLink(visibility: "public" | "password") {
    const res = await fetch(`/api/projects/${projectId}/sharing`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.detail ?? "Request failed.");
    }
  }

  async function ensureLinkAndCopy(visibility: "public" | "password", password?: string) {
    if (visibility === "password" && (!password || password.trim().length < 4)) {
      toast.error("Password must be 4+ chars.");
      return;
    }
    try {
      await upsertShareLink(visibility, password);
      const res = await getJson<SharingState>(`/api/projects/${projectId}/sharing`);
      setState(res);
      const link = res.links.find((l) => l.visibility === visibility && !l.revoked_at) ?? null;
      const slug = link?.slug;
      if (!slug) throw new Error("Link not ready yet. Try again.");
      await copy(makeShareUrl(slug), `${visibility === "public" ? "Public" : "Private"} link copied.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create link.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden border-foreground/10 bg-background/80 backdrop-blur-2xl rounded-3xl">
        <div className="p-5 sm:p-6">
          <DialogHeader className="space-y-2">
            <DialogTitle className="font-display text-2xl tracking-tight">Share design</DialogTitle>
            <DialogDescription className="text-sm">
              Control access to <span className="text-foreground/90 font-medium">{projectName}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-3">
            {/* Invite */}
            <div className="rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-3.5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <UserPlus className="size-4 text-[#eca8d6]" />
                  <div className="text-sm font-medium">Invite people</div>
                </div>
                <AccessLevelSelect value={inviteRole} onChange={setInviteRole} compact />
              </div>

              <div className="mt-3 flex gap-2">
                <Input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Email address"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  className="h-10 rounded-2xl border-foreground/15 bg-background/60 flex-1 min-w-0"
                />
                <Button
                  className="h-10 rounded-full bg-foreground text-background hover:bg-foreground/90 shrink-0 px-5"
                  disabled={loading || !isValidEmail(inviteEmail.trim())}
                  onClick={async () => {
                    const email = inviteEmail.trim();
                    if (!email) return toast.error("Enter an email.");
                    if (!isValidEmail(email)) return toast.error("Enter a valid email address.");
                    try {
                      const res = await postJson<{ invite: { token: string }; emailSent?: boolean; emailError?: string }>(
                        `/api/projects/${projectId}/sharing`,
                        { email, role: inviteRole }
                      );
                      setInviteEmail("");
                      await refresh();
                      if (res.emailSent) {
                        toast.success("Invite email sent.");
                      } else {
                        await navigator.clipboard.writeText(makeInviteUrl(res.invite.token));
                        toast.error("Email failed. Invite link copied.");
                      }
                    } catch (e: any) {
                      toast.error(e?.detail ?? e?.message ?? "Could not create invite.");
                    }
                  }}
                >
                  Send invite
                </Button>
              </div>
            </div>

            {/* Share links */}
            <div className="rounded-2xl border border-foreground/10 bg-foreground/[0.02] p-3.5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Link2 className="size-4 text-[#eca8d6]" />
                  <div className="text-sm font-medium">Share link</div>
                </div>
                <AccessLevelSelect value={linkRole} onChange={setLinkRole} compact />
              </div>

              <div className="mt-3 space-y-2">
                <Button
                  variant="outline"
                  className="w-full h-10 rounded-2xl border-foreground/15 bg-background/50 justify-between"
                  onClick={() => void ensureLinkAndCopy("public")}
                >
                  <span className="inline-flex items-center gap-2">
                    <Globe className="size-4 text-muted-foreground" />
                    Copy public link
                  </span>
                  <Copy className="size-4 text-muted-foreground" />
                </Button>

                <div className="flex gap-2">
                  <Input
                    value={privatePassword}
                    onChange={(e) => setPrivatePassword(e.target.value)}
                    placeholder="Private password"
                    type="password"
                    className="h-10 rounded-2xl border-foreground/15 bg-background/50 flex-1 min-w-0"
                  />
                  <Button
                    className="h-10 rounded-2xl bg-foreground text-background hover:bg-foreground/90 px-4 shrink-0"
                    onClick={() => void ensureLinkAndCopy("password", privatePassword)}
                  >
                    Copy private
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

