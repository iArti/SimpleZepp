// Media control: SimpleWear's MediaHelper paths and the player model used by the media pages.
// The phone side is SimpleWear's MediaControllerService (any app with a media session).

export const MEDIA = {
  CONNECT: "/media/connect", // b64 0x01 = auto-pick the active player, or a package name
  DISCONNECT: "/media/disconnect",
  STATE: "/media/playback_state",
  ART: "/media/playback_state/art", // text = cover id, served at /media/art (see app-side)
  APP_INFO: "/media/app/info",
  PLAY: "/media/action/play",
  PAUSE: "/media/action/pause",
  PREV: "/media/action/previous",
  NEXT: "/media/action/skip",
  ACTIONS: "/media/actions",
  ACTIONS_CLICK: "/media/actions/click",
  QUEUE: "/media/queueitems",
  QUEUE_CLICK: "/media/queueitems/click",
  PLAYERS: "/music-players",
  OPEN_PLAYER: "/music/start-activity",
};

// 0x01: "connect to whatever is playing" (MediaPlayerConnectPath with a single true byte)
export const AUTOLAUNCH = [1];

/**
 * MediaPlayerState JSON -> the shape the screens were written for (Spotify Remote):
 * { active, title, artist, playing, progress, duration }.
 * progress is the position at the moment the message arrived; pages extrapolate from lastSync.
 */
export function toPlayer(state) {
  const meta = (state && state.mediaMetaData) || {};
  const pos = meta.positionState || {};
  const playback = (state && state.playbackState) || "none";
  return {
    active: playback !== "none",
    title: meta.title || "",
    artist: meta.artist || "",
    playing: playback === "playing" || playback === "loading",
    progress: pos.currentPositionMs || 0,
    duration: pos.durationMs || 0,
  };
}

// Players expose "like" as a custom action (Spotify: ADD_TO "Add to collection").
// Its id/title tells whether the current track is already liked.
const LIKE_RE = /add_to|like|heart|favou?rite|collection|коллекц|нрав|избран/i;
const LIKED_RE = /remove|unlike|liked|dislike|удал|убрать/i;

export function findLike(actions) {
  const list = (actions && actions.actions) || [];
  const action = list.find((a) => LIKE_RE.test(a.action || "") || LIKE_RE.test(a.title || ""));
  if (!action) return null;
  return { id: action.action, liked: LIKED_RE.test(action.action || "") || LIKED_RE.test(action.title || "") };
}

// Everything except "like" goes to the actions page (shuffle, repeat, radio, …)
export function otherActions(actions) {
  const like = findLike(actions);
  return ((actions && actions.actions) || []).filter((a) => !like || a.action !== like.id);
}
