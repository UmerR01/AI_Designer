import type { Metadata } from "next";
import { SignupFormView } from "@/components/auth/signup-form";

export const metadata: Metadata = {
  title: "Create account — Designer",
  description: "Create a Designer workspace and start shipping creative.",
};

export default function SignupPage() {
  return <SignupFormView />;
}
