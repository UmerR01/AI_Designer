import type { Metadata } from "next";
import { ForgotPasswordFormView } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Reset password — Designer",
  description: "Reset your Designer account password.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordFormView />;
}
