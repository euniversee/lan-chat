self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Intercept share-target requests from Android
  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get("files");
          const title = formData.get("title") || "";
          const text = formData.get("text") || "";
          const sharedUrl = formData.get("url") || "";

          // 1. File Share handling
          if (file && file.size > 0) {
            const cache = await caches.open("shared-files-cache");
            // Store the shared file in the cache under a specific temporary URL
            await cache.put(
              new Request("/shared-file-temp"),
              new Response(file, {
                headers: {
                  "x-file-name": encodeURIComponent(file.name),
                  "content-type": file.type || "application/octet-stream"
                }
              })
            );

            // Redirect client to main chat view with a flag indicating a shared file is pending upload
            return Response.redirect("/?shared-file=1", 303);
          }

          // 2. Text / Link Share handling
          if (text || sharedUrl) {
            const redirectUrl = new URL("/", self.location.origin);
            if (title) redirectUrl.searchParams.set("title", title);
            if (text) redirectUrl.searchParams.set("text", text);
            if (sharedUrl) redirectUrl.searchParams.set("url", sharedUrl);

            return Response.redirect(redirectUrl.pathname + redirectUrl.search, 303);
          }
        } catch (error) {
          console.error("Service Worker: Error processing share-target POST:", error);
        }

        // Fallback redirect if anything goes wrong
        return Response.redirect("/", 303);
      })()
    );
    return;
  }

  // Standard fetch event (passthrough to network)
  event.respondWith(fetch(event.request));
});
