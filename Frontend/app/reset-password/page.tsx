import type { Metadata } from "next";
import { ResetPasswordFormView } from "@/components/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Set new password — Designer",
  description: "Choose a new password for your Designer account.",
};

export default function ResetPasswordPage() {
  return <ResetPasswordFormView />;
}
