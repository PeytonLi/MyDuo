import { meetingErrorResponse } from "@/lib/server/meetings";
import { exchangeMediaBootstrap, parseBootstrap } from "@/lib/server/speech";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = parseBootstrap(await request.json());
    return Response.json(await exchangeMediaBootstrap(input), {
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}
