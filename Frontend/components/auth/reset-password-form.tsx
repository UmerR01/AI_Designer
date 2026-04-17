"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { postJson } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/auth-shell";
import { RESET_TOKEN_MIN_LENGTH } from "@/lib/auth/reset-token-constants";

function ResetPasswordFormInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";
  const tokenOk = token.length >= RESET_TOKEN_MIN_LENGTH;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!tokenOk) {
    return (
      <AuthShell
        eyebrow="Reset password"
        title={
          <>
            Link <span className="text-[#eca8d6]">invalid</span>
          </>
        }
        subtitle="This reset link is missing, incomplete, or was cut off by your email app. Request a new reset link and open it in your browser without editing the address."
        footer={
          <p className="text-center text-[0.875rem] text-muted-foreground">
            <Link href="/login/forgot" className="text-foreground underline underline-offset-4 hover:text-[#eca8d6]">
              Send a new reset link
            </Link>
            {" · "}
            <Link href="/login" className="text-foreground underline underline-offset-4 hover:text-[#eca8d6]">
              Sign in
            </Link>
          </p>
        }
      >
        <div />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title={
        <>
          New <span className="text-[#eca8d6]">password</span>
        </>
      }
      subtitle="Choose a strong password you haven’t used elsewhere."
      footer={
        <p className="text-center text-[0.875rem] text-muted-foreground">
          <Link href="/login" className="text-foreground underline underline-offset-4 transition-colors hover:text-[#eca8d6]">
            Back to sign in
          </Link>
        </p>
      }
    >
      <form
        className="flex flex-col gap-[clamp(0.875rem,2vh,1.25rem)]"
        onSubmit={async (e) => {
          e.preventDefault();
          if (isSubmitting) return;
          if (password !== confirm) {
            toast.error("Passwords don’t match.");
            return;
          }
          if (password.length < 8) {
            toast.error("Use at least 8 characters.");
            return;
          }
          setIsSubmitting(true);
          try {
            await postJson<{ ok: boolean }>("/api/auth/reset-password", { token, password });
            toast.success("Password updated. You can sign in now.");
            window.location.href = "/login";
          } catch (err: any) {
            toast.error(err?.detail ?? err?.message ?? "Reset failed.");
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-password">New password</Label>
          <div className="relative">
            <Input
              id="new-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="8+ characters"
              className="min-h-[2.75rem] bg-foreground/[0.03] border-foreground/15 pr-10 text-[0.9375rem]"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <div className="relative">
            <Input
              id="confirm-password"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repeat password"
              className="min-h-[2.75rem] bg-foreground/[0.03] border-foreground/15 pr-10 text-[0.9375rem]"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={8}
              required
            />
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              onClick={() => setShowConfirm((v) => !v)}
              aria-label={showConfirm ? "Hide password" : "Show password"}
            >
              {showConfirm ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </button>
          </div>
        </div>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="min-h-[2.75rem] w-full rounded-full bg-foreground text-[0.875rem] font-medium text-background hover:bg-foreground/90"
        >
          {isSubmitting ? "Saving…" : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
}

export function ResetPasswordFormView() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">Loading…</div>
      }
    >
      <ResetPasswordFormInner />
    </Suspense>
  );
}
