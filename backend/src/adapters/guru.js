export default {
  id: 'guru', name: 'Guru', domains: ['guru.com'],
  sourceModes: ['email_import', 'user_import'],
  apiStatus: 'No public quote-submission API verified. Job Match emails and WorkRoom notifications are supported.',
  canAutoSubmit: false,
  documentation: 'https://www.guru.com/help/freelancer/email-settings-freelancer/',
  isJobPath: url => /^\/jobs\/[^/]+\/\d+\/?$/i.test(url.pathname),
  isConversationPath: url => /^\/(?:workroom|workrooms)\/(?:\d+|[a-z0-9_-]{6,})(?:\/|$)/i.test(url.pathname)
};
