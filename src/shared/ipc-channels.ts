export const IPC_CHANNELS = {
  restore: "session:restore",
  login: "session:login",
  sendMfa: "session:send-mfa",
  verifyMfa: "session:verify-mfa",
  logout: "session:logout",
  listClassifications: "library:list-classifications",
  listCollections: "library:list-collections",
  getCollectionDetail: "library:get-detail",
  listContinueWatching: "library:list-continue-watching",
  loadImage: "library:load-image",
  getNavigation: "library:get-navigation",
  setNavigation: "library:set-navigation",
} as const;
