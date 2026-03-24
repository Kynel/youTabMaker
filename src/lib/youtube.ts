const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be"
]);

function parseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function extractVideoId(input: string): string | null {
  const url = parseUrl(input);

  if (!url || !YOUTUBE_HOSTS.has(url.hostname)) {
    return null;
  }

  if (url.hostname === "youtu.be") {
    return url.pathname.replace("/", "") || null;
  }

  if (url.pathname === "/watch") {
    return url.searchParams.get("v");
  }

  if (url.pathname.startsWith("/shorts/")) {
    return url.pathname.split("/")[2] || null;
  }

  return null;
}

export function isYouTubeUrl(input: string): boolean {
  return extractVideoId(input) !== null;
}

export function normalizeYouTubeUrl(input: string): string {
  const videoId = extractVideoId(input);

  if (!videoId) {
    throw new Error("A valid YouTube video URL is required.");
  }

  return `https://www.youtube.com/watch?v=${videoId}`;
}
