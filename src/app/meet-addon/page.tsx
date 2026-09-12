import { MeetAddonClient } from "./meet-addon-client";
import styles from "./meet-addon.module.css";

export default function MeetAddonPage() {
  return (
    <main className={styles.shell}>
      <MeetAddonClient cloudProjectNumber={process.env.GOOGLE_MEET_ADDON_CLOUD_PROJECT_NUMBER?.trim() || ""} />
    </main>
  );
}
