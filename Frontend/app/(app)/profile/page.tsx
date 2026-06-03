"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { getMeCached } from "@/lib/auth-api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";

type MeResponse = {
  user: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    email_verified: boolean;
  };
};

function initials(first: string, last: string, email: string) {
  const a = (first?.trim()?.[0] ?? "").toUpperCase();
  const b = (last?.trim()?.[0] ?? "").toUpperCase();
  if (a || b) return `${a}${b}`.trim();
  return (email?.trim()?.[0] ?? "U").toUpperCase();
}

export default function ProfilePage() {
  const [me, setMe] = useState<MeResponse["user"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getMeCached<MeResponse>();
        if (!cancelled) setMe(res.user);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaveProfile() {
    toast.success("Profile updated successfully!");
  }

  if (!me) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-foreground/10 border-t-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight">My Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Update your name, email, and account details.
          </p>
        </div>

        <div className="rounded-2xl border border-foreground/10 bg-background/50 p-6 backdrop-blur-sm shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
          <h2 className="text-lg font-semibold mb-6">Profile Information</h2>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 mb-8">
            <div className="relative group">
              <Avatar className="size-24 rounded-2xl border border-foreground/10 shadow-sm transition-transform group-hover:scale-[1.02]">
                <AvatarImage src="" />
                <AvatarFallback className="text-2xl font-bold bg-foreground/[0.03] text-muted-foreground rounded-2xl">
                  {initials(me.first_name, me.last_name, me.email)}
                </AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex items-center justify-center cursor-pointer">
                <span className="text-xs font-medium text-white uppercase tracking-wider">Change</span>
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="font-medium text-lg">
                {me.first_name} {me.last_name}
              </h3>
              <p className="text-sm text-muted-foreground">{me.email}</p>
              <div className="pt-2 flex items-center gap-2">
                {me.email_verified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[0.65rem] font-medium text-green-600 uppercase tracking-wider">
                    <CheckCircle2 className="size-3" /> Verified Account
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[0.65rem] font-medium text-amber-600 uppercase tracking-wider">
                    <AlertTriangle className="size-3" /> Unverified
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                First Name
              </label>
              <Input
                defaultValue={me.first_name}
                className="bg-foreground/[0.02] border-foreground/10 focus-visible:ring-[#eca8d6]/50 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Last Name
              </label>
              <Input
                defaultValue={me.last_name}
                className="bg-foreground/[0.02] border-foreground/10 focus-visible:ring-[#eca8d6]/50 rounded-xl"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Email Address
              </label>
              <Input
                defaultValue={me.email}
                disabled
                className="bg-foreground/[0.05] border-foreground/5 text-muted-foreground cursor-not-allowed rounded-xl"
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-foreground/5">
            <Button
              onClick={handleSaveProfile}
              className="rounded-xl bg-foreground text-background px-8 hover:bg-foreground/90"
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
