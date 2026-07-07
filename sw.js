// SideEye service worker — receives pushes and shows notifications.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data.json(); } catch { data = { title: "SideEye", body: event.data?.text() ?? "" }; }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "SideEye", {
      body: data.body ?? "",
      icon: "/sideeye/pwa-icon-192.png",
      badge: "/sideeye/pwa-icon-192.png",
      tag: data.tag ?? "sideeye",
      data: { url: data.url ?? "/sideeye/" },
    })
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url ?? "/sideeye/"));
});
