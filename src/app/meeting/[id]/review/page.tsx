import { ReviewClient } from "@/components/review-client";

export default async function MeetingReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReviewClient sessionId={id} />;
}
