import { NextResponse } from "next/server";
import { requireSupportAgent } from "@/lib/support/auth";
import { publishSupportEvent } from "@/lib/support/realtime";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const agent = await requireSupportAgent().catch(() => null);
  if (!agent) return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const { id } = await params;

  try {
    await publishSupportEvent({
      type: "call.ring",
      conversationId: id,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ detail: e.message }, { status: 500 });
  }
}
