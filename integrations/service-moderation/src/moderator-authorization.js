export async function authorizePrepare(event, env, fetchRequest = fetch) {
  const repo = env.GITHUB_REPOSITORY;
  const login = event.comment?.user?.login;
  const issue = event.issue?.number;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '') ||
      !/^[A-Za-z0-9-]+(?:\[bot\])?$/.test(login || '') ||
      !Number.isSafeInteger(issue) || issue < 1 || !env.GH_TOKEN ||
      event.comment?.body?.trim() !== '/prepare' || event.issue?.pull_request) {
    throw new Error('Invalid moderation authorization context.');
  }
  const get = async route => {
    const response = await fetchRequest('https://api.github.com/repos/' + repo + route, {
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + env.GH_TOKEN,
        'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'discrete-services-moderation/0.1' }
    });
    if (!response.ok) throw new Error('Cannot verify moderation authority.');
    return response.json();
  };
  const repository = await get('');
  if (repository.private !== true || repository.full_name?.toLowerCase() !== repo.toLowerCase()) {
    throw new Error('Moderation requires the configured private repository.');
  }
  const permission = await get('/collaborators/' + encodeURIComponent(login) + '/permission');
  if (!['write', 'admin'].includes(permission.permission)) {
    throw new Error('The prepare command requires repository write authority.');
  }
  // Use the current checklist, not a stale webhook snapshot.
  const current = await get('/issues/' + issue);
  if (current.number !== issue || current.state !== 'open' || current.pull_request) {
    throw new Error('The prepare command must target an open issue.');
  }
  return current;
}
