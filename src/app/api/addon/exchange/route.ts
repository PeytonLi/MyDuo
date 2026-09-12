import { exchangeAddonPair, parsePairingCode } from "@/lib/server/addon";
import { assertMutationOrigin } from "@/lib/server/auth";
import { meetingErrorResponse } from "@/lib/server/meetings";

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const { code } = parsePairingCode(await request.json());
    return Response.json(await exchangeAddonPair(code), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return meetingErrorResponse(error);
  }
}
