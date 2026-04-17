"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { postJson } from "@/lib/auth-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/auth-shell";

export function ForgotPasswordFormView() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <AuthShell
      eyebrow="Account recovery"
      title={
        <>
          Reset <span className="text-[#eca8d6]">password</span>
        </>
      }
      subtitle={
        <>
          We&apos;ll email you a link to choose a new password.{" "}
          <strong>Check spam</strong> if nothing arrives in a few minutes.
        </>
      }
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
          setIsSubmitting(true);
          try {
            const form = e.currentTarget;
            const fd = new FormData(form);
            const res = await postJson<{ ok: boolean; _dev?: { userFound: boolean; emailSent?: boolean; dbOrMailError?: string } }>(
              "/api/auth/forgot-password",
              {
                email: String(fd.get("email") ?? ""),
              }
            );
            const dev = res._dev;
            if (process.env.NODE_ENV === "development" && dev) {
              if (!dev.userFound) {
                toast.warning("Dev: no account uses this email — no mail sent. Use the exact email you signed up with.");
                return;
              }
              if (dev.emailSent === false) {
                toast.error(
                  `Dev: mail not sent${dev.dbOrMailError ? ` — ${dev.dbOrMailError}` : ""}. Check terminal / DB (password_reset_tokens).`
                );
                return;
              }
            }
            toast.success("If an account exists for that email, we sent a reset link.");
            form.reset();
          } catch (err: any) {
            toast.error(err?.detail ?? err?.message ?? "Something went wrong.");
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
            required
          />
        </div>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="min-h-[2.75rem] w-full rounded-full bg-foreground text-[0.875rem] font-medium text-background hover:bg-foreground/90"
        >
          {isSubmitting ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </AuthShell>
  );
}
