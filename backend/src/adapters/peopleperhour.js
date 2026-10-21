export default {
  id: 'peopleperhour', name: 'PeoplePerHour', domains: ['peopleperhour.com'],
  sourceModes: ['email_import', 'user_import'],
  apiStatus: 'No public marketplace submission API verified. Saved-search emails and user imports are supported.',
  canAutoSubmit: false,
  documentation: 'https://support.peopleperhour.com/hc/en-us/articles/205217987-Saved-Searches',
  isJobPath: url => /^\/(?:freelance-jobs\/(?:[^/]+\/)*[^/]+-\d+|job\/[^/]+-\d+)\/?$/i.test(url.pathname),
  isConversationPath: url => /^\/(?:workstream|workstreams)\/(?:view\/)?[^/]+/i.test(url.pathname)
};
