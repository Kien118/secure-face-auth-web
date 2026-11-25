const $ = id => document.getElementById(id);
const post = (path, method = 'POST') => fetch(path, {
  method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined
});

const response = await fetch('/api/session');
if (response.status !== 200) {
  location.replace('/');
} else {
  const session = await response.json();
  $('welcome').textContent = `Signed in as ${session.accountId}`;
  $('session-info').textContent = `Session expires at ${new Date(session.expiresAt).toLocaleTimeString()}.`;
  $('logout').disabled = $('delete').disabled = false;
}

$('logout').addEventListener('click', async () => {
  await post('/api/logout');
  location.replace('/');
});

$('delete').addEventListener('click', async () => {
  if (!confirm('Permanently delete the face template for this account? You will need to enroll again.')) return;
  const result = await post('/api/templates/me', 'DELETE');
  $('account-status').textContent = result.ok ? 'Template deleted.' : 'Delete failed.';
  if (result.ok) setTimeout(() => location.replace('/'), 800);
});
