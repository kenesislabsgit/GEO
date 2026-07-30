import { NextResponse } from "next/server";
import { domainInputSchema } from "@/lib/security/url";
import { readWebsiteShared } from "@/lib/ai/website/shared-understanding";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const domain = domainInputSchema.parse(body.domain);

    // Anyone may preview and audit any website, including one someone else has
    // already audited. A recent read of the website is reused so the preview is
    // fast, but nobody is sent to another person's report.
    const { understanding, reused } = await readWebsiteShared(domain);
    return NextResponse.json({
      cached: false,
      reusedWebsiteRead: reused,
      understanding,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
