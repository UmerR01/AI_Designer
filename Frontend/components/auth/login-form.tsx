"use client";

import Link from "next/link";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { postJson } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthShell } from "@/components/auth/auth-shell";

export function LoginFormView() {
  const [remember, setRemember] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <AuthShell
      eyebrow="Sign in"
      title={
        <>
          Welcome <span className="text-[#eca8d6]">back</span>
        </>
      }
      subtitle={
        <>
          Continue to your workspace—your{" "}
          <strong>briefs, brand kits, and exports</strong> in one place.
        </>
      }
      footer={
        <p className="text-center text-[0.875rem] text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="text-foreground underline underline-offset-4 transition-colors hover:text-[#eca8d6]"
          >
            Create one
          </Link>
        </p>
      }
    >
      <form
        className="flex flex-col gap-[clamp(0.875rem,2vh,1.25rem)]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (isSubmitting) return;
          setIsSubmitting(true);
          try {
            const form = e.currentTarget;
            const formData = new FormData(form);
            await postJson<{ user: any }>("/api/auth/login", {
              email: String(formData.get("email") ?? ""),
              password: String(formData.get("password") ?? ""),
              remember,
            });
            toast.success("Welcome back.");
            window.location.href = "/dashboard";
          } catch (err: any) {
            const msg = String(err?.detail ?? err?.message ?? "Sign in failed.");
            toast.error(msg);
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            className="min-h-[2.75rem] bg-foreground/[0.03] border-foreground/15 text-[0.9375rem]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/login/forgot"
              className="text-[0.75rem] font-mono text-muted-foreground transition-colors hover:text-[#eca8d6]"
            >
              Forgot?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              className="min-h-[2.75rem] bg-foreground/[0.03] border-foreground/15 pr-10 text-[0.9375rem]"
              required
            />
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="remember"
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
          />
          <Label htmlFor="remember" className="cursor-pointer text-[0.875rem] font-normal text-muted-foreground">
            Keep me signed in on this device
          </Label>
        </div>

        <Button
          type="submit"
          disabled={isSubmitting}
          className="min-h-[2.75rem] w-full rounded-full bg-foreground text-[0.875rem] font-medium text-background hover:bg-foreground/90"
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-center text-[0.75rem] leading-relaxed text-muted-foreground">
        By signing in you agree to our{" "}
        <Link href="#" className="underline underline-offset-2 hover:text-foreground">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="#" className="underline underline-offset-2 hover:text-foreground">
          Privacy
        </Link>
        .
      </p>
    </AuthShell>
  );
}
