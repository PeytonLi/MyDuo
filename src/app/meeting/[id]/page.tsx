import { MeetingClient } from "@/components/meeting-client";

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MeetingClient sessionId={id} />;
}
