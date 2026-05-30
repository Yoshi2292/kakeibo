let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

export async function initAuth() {
  await waitForGIS();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    callback: () => {},
  });
}

function waitForGIS() {
  return new Promise((resolve) => {
    if (typeof google !== 'undefined' && google.accounts?.oauth2) {
      resolve();
      return;
    }
    const id = setInterval(() => {
      if (typeof google !== 'undefined' && google.accounts?.oauth2) {
        clearInterval(id);
        resolve();
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
