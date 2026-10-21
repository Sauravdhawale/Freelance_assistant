export default {
  id: 'fiverr', name: 'Fiverr', domains: ['fiverr.com'],
  sourceModes: ['email_import', 'user_import'],
  apiStatus: 'No public seller automation API verified. Incoming inquiries and user-supplied Gig data only.',
  canAutoSubmit: false,
  documentation: 'https://help.fiverr.com/hc/en-us/articles/37554441398929-Our-Community-Standards',
  isJobPath: () => false,
  isConversationPath: url => /^\/(?:inbox\/[^/]+|users\/[^/]+\/orders\/[^/]+|orders\/[^/]+)/i.test(url.pathname)
};
