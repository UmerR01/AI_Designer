import type { Metadata } from "next";
import { LoginFormView } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in — Designer",
  description: "Sign in to your Designer workspace.",
};

export default function LoginPage() {
  return <LoginFormView />;
}
