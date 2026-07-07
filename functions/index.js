const {onValueCreated} = require('firebase-functions/v2/database');
const admin = require('firebase-admin');

admin.initializeApp();

const TITLES = {
  birdie_alert: '🐦 Birdie!',
  eagle_alert: '🦅 Eagle alert!',
  three_putt: '🍺 Shotgun time',
  lead_change: '👑 Lead change',
  round_complete: '🏁 Round complete',
  shotgun_video: '🍺 Shotgun done',
  milestone: '🎉 Milestone',
  manual_post: '💬 New post',
  photo_post: '📸 New photo',
  video_post: '🎥 New video',
};

// Per-player mutable notification groups; mirrors NOTIF_*_TYPES in index.html.
// Mentions and lead changes always notify.
const SCORE_TYPES = ['birdie_alert', 'eagle_alert', 'three_putt', 'round_complete', 'shotgun_video'];
const POST_TYPES = ['manual_post', 'photo_post', 'video_post', 'milestone', 'system'];

// First names for @mention detection (static roster; mirrors PLAYERS in index.html)
const FIRST_NAMES = {
  matt: 'matthew', grant: 'grant', adam: 'adam', jordan: 'jordan', jordanb: 'jordan',
  john: 'john', marc: 'marc', webby: 'matt', jake: 'jacob', justin: 'justin',
  rastani: 'mark', mark: 'mark',
};

function wantsPush(pid, post, body, profiles) {
  const lower = body.toLowerCase();
  if (FIRST_NAMES[pid] && lower.includes('@' + FIRST_NAMES[pid])) return true; // mentioned
  if (post.type === 'lead_change') return true;
  const prefs = (profiles[pid] && profiles[pid].notifPrefs) || {};
  if (SCORE_TYPES.includes(post.type) && prefs.scores === false) return false;
  if (POST_TYPES.includes(post.type) && prefs.posts === false) return false;
  return true;
}

// Push every new feed post to every registered device except the author's.
exports.pushFeedPost = onValueCreated(
  {ref: '/sync/feed/{postId}', region: 'us-central1'},
  async (event) => {
    const post = event.data.val();
    if (!post || !post.text) return;

    const body = String(post.text).replace(/<[^>]+>/g, '').slice(0, 180);
    const title = TITLES[post.type] || 'Perry Park Cup';

    const [snap, profSnap] = await Promise.all([
      admin.database().ref('sync/fcmTokens').get(),
      admin.database().ref('sync/profiles').get(),
    ]);
    const byPlayer = snap.val() || {};
    const profiles = profSnap.val() || {};
    const tokens = [];
    const owner = {}; // token -> "playerId/key" for pruning
    Object.entries(byPlayer).forEach(([pid, toks]) => {
      if (pid === post.playerId) return; // don't notify the author
      if (!wantsPush(pid, post, body, profiles)) return; // muted by their prefs
      Object.entries(toks || {}).forEach(([key, t]) => {
        if (typeof t === 'string') { tokens.push(t); owner[t] = `${pid}/${key}`; }
      });
    });
    if (!tokens.length) return;

    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      webpush: {
        notification: {
          title,
          body,
          icon: 'https://jgr.golf/icons/icon-192.svg',
          badge: 'https://jgr.golf/icons/icon-192.svg',
          tag: post.id || 'perry-park',
        },
        fcmOptions: {link: 'https://jgr.golf/'},
      },
    });

    // Prune tokens FCM reports as dead
    const updates = {};
    res.responses.forEach((r, i) => {
      const code = r.error && r.error.code;
      if (!r.success && (code === 'messaging/registration-token-not-registered' ||
                         code === 'messaging/invalid-registration-token' ||
                         code === 'messaging/invalid-argument')) {
        updates[`sync/fcmTokens/${owner[tokens[i]]}`] = null;
      }
    });
    if (Object.keys(updates).length) await admin.database().ref().update(updates);
  }
);
