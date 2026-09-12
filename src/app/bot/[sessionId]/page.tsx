import { z } from "zod";
import BotMediaClient from "./BotMediaClient";
import styles from "./bot.module.css";

export const dynamic = "force-dynamic";

export default async function BotMediaPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const sessionId = z.string().uuid().parse((await params).sessionId);
  return (
    <main className={styles.shell}>
      <div className={styles.mark} aria-hidden="true">D</div>
      <p className={styles.label}>MyDuo meeting voice</p>
      <BotMediaClient sessionId={sessionId} />
    </main>
  );
}
