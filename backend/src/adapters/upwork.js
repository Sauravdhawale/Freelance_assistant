export default {
  id: 'upwork', name: 'Upwork', domains: ['upwork.com'],
  sourceModes: ['email_import', 'user_import'],
  apiStatus: 'Approval and exact granted scope required; direct API actions are not enabled.',
  canAutoSubmit: false,
  documentation: 'https://support.upwork.com/hc/en-us/articles/43342677368467-Use-bots-and-other-automation-properly',
  isJobPath: url => /^\/(?:jobs\/~[a-z0-9]+\/?$|freelance-jobs\/apply\/[^/]+_~[a-z0-9]+\/?$)/i.test(url.pathname),
  isConversationPath: url => /^\/(?:ab\/)?messages\/rooms\/[^/]+/i.test(url.pathname)
};
