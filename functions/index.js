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

// Push every new feed post to every registered device except the author's.
exports.pushFeedPost = onValueCreated(
  {ref: '/sync/feed/{postId}', region: 'us-central1'},
  async (event) => {
    const post = event.data.val();
    if (!post || !post.text) return;

    const body = String(post.text).replace(/<[^>]+>/g, '').slice(0, 180);
    const title = TITLES[post.type] || 'Perry Park Cup';

    const snap = await admin.database().ref('sync/fcmTokens').get();
    const byPlayer = snap.val() || {};
    const tokens = [];
    const owner = {}; // token -> "playerId/key" for pruning
    Object.entries(byPlayer).forEach(([pid, toks]) => {
      if (pid === post.playerId) return; // don't notify the author
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
