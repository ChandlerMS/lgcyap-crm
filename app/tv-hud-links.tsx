import styles from "./tv-hud-links.module.css";

export default function TvHudLinks({ service }: { service: "leaderboard" | "queue" }) {
  return <section className={styles.panel} aria-label={`${service === "queue" ? "Queue" : "Leaderboard"} TV HUD`}>
    <h2>TV HUD</h2>
    <div className={styles.links}>
      <a href={`https://${service}.lgcyap.com/shopper`} target="_blank" rel="noopener noreferrer">Shopper<span className="sr-only"> (opens in a new tab)</span></a>
      <a href={`https://${service}.lgcyap.com/standard`} target="_blank" rel="noopener noreferrer">Standard vs Preferred<span className="sr-only"> (opens in a new tab)</span></a>
    </div>
  </section>;
}
