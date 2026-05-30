let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

export async function initAuth() {
  await waitForGIS();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/cloud-vision',
    callback: () => {},
  });
}

function waitForGIS(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (typeof google !== 'undefined' && google.accounts?.oauth2) {
      resolve();
      return;
    }
    const deadline = Date.now() + timeoutMs;
    const id = setInterval(() => {
      if (typeof google !== 'undefined' && google.accounts?.oauth2) {
        clearInterval(id);
        resolve();
      } else if (Date.now() > deadline) {
        clearInterval(id);
        reject(new Error('Google Identity Services の読み込みがタイムアウトしました。ネットワーク接続を確認してください。'));
      }
    }, 100);
  });
}

export function login() {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (res) => {
      if (res.error) { reject(new Error(res.error)); return; }
      _storeToken(res);
      resolve();
    };
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

export function getToken() {
  if (accessToken && Date.now() < tokenExpiry - 60_000) {
    return Promise.resolve(accessToken);
  }
  return new Promise((resolve, reject) => {
    tokenClient.callback = (res) => {
      if (res.error) { reject(new Error(res.error)); return; }
      _storeToken(res);
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

export function isLoggedIn() {
  return !!(accessToken && Date.now() < tokenExpiry);
}

export function logout() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiry = 0;
}

function _storeToken(res) {
  accessToken = res.access_token;
  tokenExpiry = Date.now() + res.expires_in * 1000;
}
