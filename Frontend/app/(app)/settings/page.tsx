"use client";

import { useEffect, useState } from "react";
import { 
  User, 
  Settings2, 
  CreditCard, 
  Bell, 
  Palette, 
  Monitor, 
  Lock, 
  LogOut, 
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Cloud
} from "lucide-react";
import { getMeCached, postJson, getJson } from "@/lib/auth-api";
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

export default function SettingsPage() {
  const [me, setMe] = useState<MeResponse["user"] | null>(null);
  const [activeTab, setActiveTab] = useState<"profile" | "workspace" | "billing" | "security">("profile");
  const [projCount, setProjCount] = useState(0);

  const fetchProjCount = async () => {
    try {
      const res = await getJson<{ projects: any[] }>("/api/projects?status=active");
      if (res && res.projects) setProjCount(res.projects.length);
    } catch (e) {}
  };

  useEffect(() => {
    fetchProjCount();
  }, []);

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

  async function handleLogout() {
    try {
      await postJson("/api/auth/logout", {});
      window.location.replace("/login");
    } catch {
      window.location.replace("/login");
    }
  }

  function handleSaveProfile() {
    toast.success("Profile updated successfully!");
  }

  if (!me) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-foreground/10 border-t-foreground" />
      </div>
    );
  }

  const tabs = [
    { id: "profile", label: "My Profile", icon: User },
    { id: "workspace", label: "Workspace", icon: Palette },
    { id: "billing", label: "Plan & Credits", icon: CreditCard },
    { id: "security", label: "Security", icon: Lock },
  ] as const;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight">Account Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your personal profile, workspace preferences, and AI credits.</p>
        </div>

        <div className="flex flex-col md:flex-row gap-8">
          {/* Settings Nav */}
          <aside className="w-full md:w-64 shrink-0">
            <nav className="flex flex-row md:flex-col gap-1 overflow-x-auto no-scrollbar pb-2 md:pb-0">
              {tabs.map((tab) => {
                const active = activeTab === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all whitespace-nowrap ${
                      active 
                        ? "bg-foreground/5 text-foreground" 
                        : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                    }`}
                  >
                    <Icon className={`size-4 ${active ? "text-[#eca8d6]" : "opacity-70"}`} />
                    {tab.label}
                  </button>
                );
              })}
              
              <div className="hidden md:block my-4 h-px w-full bg-foreground/5" />
              
              <button
                onClick={handleLogout}
                className="hidden md:flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <LogOut className="size-4" />
                Sign Out
              </button>
            </nav>
          </aside>

          {/* Settings Content */}
          <div className="flex-1 space-y-8 pb-16">
            {activeTab === "profile" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="rounded-2xl border border-foreground/10 bg-background/50 p-6 backdrop-blur-sm shadow-sm">
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
                      <h3 className="font-medium text-lg">{me.first_name} {me.last_name}</h3>
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
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">First Name</label>
                      <Input defaultValue={me.first_name} className="bg-foreground/[0.02] border-foreground/10 focus-visible:ring-[#eca8d6]/50 rounded-xl" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Last Name</label>
                      <Input defaultValue={me.last_name} className="bg-foreground/[0.02] border-foreground/10 focus-visible:ring-[#eca8d6]/50 rounded-xl" />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email Address</label>
                      <Input defaultValue={me.email} disabled className="bg-foreground/[0.05] border-foreground/5 text-muted-foreground cursor-not-allowed rounded-xl" />
                    </div>
                  </div>

                  <div className="flex justify-end pt-4 border-t border-foreground/5">
                    <Button onClick={handleSaveProfile} className="rounded-xl bg-foreground text-background px-8 hover:bg-foreground/90">
                      Save Changes
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "workspace" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="rounded-2xl border border-foreground/10 bg-background/50 p-6 backdrop-blur-sm shadow-sm">
                  <h2 className="text-lg font-semibold mb-6">Editor Preferences</h2>
                  
                  <div className="space-y-6">
                    <div className="flex items-center justify-between p-4 rounded-xl border border-foreground/5 bg-foreground/[0.01]">
                      <div className="space-y-1">
                        <h3 className="font-medium">Dark Mode Canvas</h3>
                        <p className="text-sm text-muted-foreground">Use a dark background for the infinite drafting canvas by default.</p>
                      </div>
                      <div className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[#eca8d6] focus:ring-offset-2">
                        <span className="inline-block size-4 translate-x-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out" />
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-xl border border-foreground/5 bg-foreground/[0.01]">
                      <div className="space-y-1">
                        <h3 className="font-medium">Auto-Save Projects</h3>
                        <p className="text-sm text-muted-foreground">Automatically sync your drafts to the cloud every few seconds.</p>
                      </div>
                      <div className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#eca8d6] transition-colors focus:outline-none focus:ring-2 focus:ring-[#eca8d6] focus:ring-offset-2">
                        <span className="inline-block size-4 translate-x-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out" />
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-xl border border-foreground/5 bg-foreground/[0.01]">
                      <div className="space-y-1">
                        <h3 className="font-medium">Show Blueprint Grid</h3>
                        <p className="text-sm text-muted-foreground">Display the 24px pixel grid overlay in UI/UX and Campaign designs.</p>
                      </div>
                      <div className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#eca8d6] transition-colors focus:outline-none focus:ring-2 focus:ring-[#eca8d6] focus:ring-offset-2">
                        <span className="inline-block size-4 translate-x-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "billing" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="rounded-2xl border border-[#eca8d6]/30 bg-gradient-to-br from-[#eca8d6]/5 to-transparent p-6 shadow-sm">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#eca8d6]/20 text-[#eca8d6] text-[0.65rem] font-bold uppercase tracking-wider mb-2">
                        <Sparkles className="size-3" /> Free Tier
                      </div>
                      <h2 className="text-xl font-bold">Designer Basic</h2>
                      <p className="text-sm text-muted-foreground">You are currently on the free preview tier.</p>
                    </div>
                    <Button className="rounded-xl bg-[#eca8d6] hover:bg-[#eca8d6]/90 text-white font-semibold px-6">
                      Upgrade to Pro
                    </Button>
                  </div>

                  <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-foreground/5 bg-background p-4">
                      <div className="text-sm font-medium text-muted-foreground mb-1">AI Generations</div>
                      <div className="flex items-end gap-2">
                        <span className="text-3xl font-display font-bold">120</span>
                        <span className="text-sm text-muted-foreground pb-1">/ 150 remaining</span>
                      </div>
                      <div className="mt-3 h-1.5 w-full bg-foreground/5 rounded-full overflow-hidden">
                        <div className="h-full bg-[#eca8d6] rounded-full" style={{ width: '20%' }} />
                      </div>
                    </div>
                    
                    {(() => {
                      const storageUsed = Number((projCount * 0.48 + 0.35).toFixed(1));
                      const percentage = Math.min((storageUsed / 5.0) * 100, 100);
                      const isFull = storageUsed >= 4.0;
                      return (
                        <div className="rounded-xl border border-foreground/5 bg-background p-4 flex flex-col">
                          <div className="text-sm font-medium text-muted-foreground mb-1">Cloud Storage</div>
                          <div className="flex items-end gap-2">
                            <span className="text-3xl font-display font-bold">{storageUsed}</span>
                            <span className="text-sm text-muted-foreground pb-1">/ 5 GB used</span>
                          </div>
                          <div className="mt-3 mb-4 h-1.5 w-full bg-foreground/5 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-400 rounded-full transition-all duration-300" style={{ width: `${percentage}%` }} />
                          </div>
                          {/* Condition: >= 4 GB */}
                          <div className="mt-auto pt-4 border-t border-foreground/5">
                            {isFull ? (
                              <Button
                                variant="outline"
                                className="w-full rounded-lg text-xs font-bold uppercase tracking-wider text-blue-500 border-blue-500/20 hover:bg-blue-500/10"
                                onClick={() => toast.success("Buy Space system initiated!")}
                              >
                                Buy More Space
                              </Button>
                            ) : (
                              <div className="text-xs text-muted-foreground text-center">
                                Buy Space available at 4 GB (current: {storageUsed} GB)
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="mt-6 rounded-xl border border-green-500/20 bg-green-500/[0.02] p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-bold text-green-600 mb-1">Invite & Earn Credits</h3>
                      <p className="text-xs text-muted-foreground">Refer friend to get AI Developer Platform $500 credits free</p>
                    </div>
                    <Button 
                      className="shrink-0 rounded-xl bg-green-500 hover:bg-green-600 text-white shadow-sm text-xs font-bold px-6"
                      onClick={() => {
                        navigator.clipboard.writeText(window.location.origin + "/register?ref=" + me?.id);
                        toast.success("Referral link copied to clipboard!");
                      }}
                    >
                      Get Referral Link
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "security" && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="rounded-2xl border border-foreground/10 bg-background/50 p-6 backdrop-blur-sm shadow-sm">
                  <h2 className="text-lg font-semibold mb-6">Security & Authentication</h2>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-xl border border-foreground/5 bg-foreground/[0.01]">
                      <div className="space-y-1">
                        <h3 className="font-medium">Password</h3>
                        <p className="text-sm text-muted-foreground">Last changed 3 months ago</p>
                      </div>
                      <Button variant="outline" className="rounded-xl">Update</Button>
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-xl border border-foreground/5 bg-foreground/[0.01]">
                      <div className="space-y-1">
                        <h3 className="font-medium">Two-Factor Authentication</h3>
                        <p className="text-sm text-muted-foreground">Add an extra layer of security to your account.</p>
                      </div>
                      <Button variant="outline" className="rounded-xl">Enable</Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.02] p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-red-600 mb-2">Danger Zone</h2>
                  <p className="text-sm text-muted-foreground mb-6">Once you delete your account, there is no going back. Please be certain.</p>
                  
                  <Button variant="destructive" className="rounded-xl bg-red-500 hover:bg-red-600">
                    Delete Account
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
