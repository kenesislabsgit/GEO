import { reportShareImage } from "@/lib/reports/share-image";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return reportShareImage(slug, new URL(request.url).searchParams.get("scan"));
}
