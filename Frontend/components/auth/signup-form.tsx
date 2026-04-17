"use client";

import Link from "next/link";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { postJson } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/auth-shell";

export function SignupFormView() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <AuthShell
      eyebrow="Get started"
      title={
        <>
          Create your <span className="text-[#eca8d6]">workspace</span>
        </>
      }
      subtitle="Set up in minutes."
      footer={
        <p className="text-center text-[0.875rem] text-muted-foreground">
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-foreground underline underline-offset-4 transition-colors hover:text-[#eca8d6]"
          >
            Sign in
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
            await postJson<{ ok: true }>("/api/auth/signup", {
              first_name: String(formData.get("first") ?? ""),
              last_name: String(formData.get("last") ?? ""),
              email: String(formData.get("email") ?? ""),
              password: String(formData.get("password") ?? ""),
            });
            toast.success("Account created.");
            window.location.href = "/dashboard";
          } catch (err: any) {
            toast.error(err?.detail ?? err?.message ?? "Sign up failed.");
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <div className="grid grid-cols-1 gap-[clamp(0.75rem,2vw,1rem)] sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="first">First name</Label>
            <Input
              id="first"
              name="first"
              autoComplete="given-name"
              placeholder="Alex"
              className="min-h-[2.75rem] bg-foreground/[0.03] border-foreground/15 text-[0.9375rem]"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="last">Last name</Label>
            <Input
              id="last"
              name="last"
              autoComplete="family-name"
              placeholder="Rivera"
              className="min-h-[2.75rem] bg-foreground/[0.03] border-foreground/15 text-[0.9375rem]"
              required
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            className="min-h-[2.75rem] bg-foreground/[0.03] border-foreground/15 text-[0.9375rem]"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="8+ chars, one number"
              className="min-h-[2.75rem] bg-foreground/[0.03] border-foreground/15 pr-10 text-[0.9375rem]"
              minLength={8}
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

        <Button
          type="submit"
          disabled={isSubmitting}
          className="min-h-[2.75rem] w-full rounded-full bg-foreground text-[0.875rem] font-medium text-background hover:bg-foreground/90"
        >
          {isSubmitting ? "Creating…" : "Create account"}
        </Button>
      </form>

      <p className="text-center text-[0.75rem] leading-relaxed text-muted-foreground">
        By creating an account you agree to our{" "}
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
