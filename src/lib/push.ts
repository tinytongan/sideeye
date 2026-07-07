// Web push subscription (PWA). iOS requires 16.4+, installed to home screen.
import { Platform } from "react-native";
import { supabase } from "./supabase";

// VAPID public key — public by design (the private half lives server-side).
const VAPID_PUBLIC_KEY =
  "BJ5MWBxScWvbNfIQVNS_39YOf00csuWrRYoZWNbTOeIAm4ySbNeLpM9_02qYyHwtJ10trgiNmxdhBRaOj3-ogLE";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function pushEnabled(): boolean {
  return pushSupported() && Notification.permission === "granted";
}

/** Register SW, ask permission, subscribe, store server-side. */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: "This browser can't do push. On iPhone: iOS 16.4+, installed to home screen." };
  const reg = await navigator.serviceWorker.register("/sideeye/sw.js", { scope: "/sideeye/" });
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "Permission declined. The Wombat respects that. Barely." };
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const json = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    { endpoint: sub.endpoint, subscription: json },
    { onConflict: "endpoint" }
  );
  if (error) return { ok: false, reason: "Couldn't save the subscription. Poke Claude." };
  return { ok: true };
}
