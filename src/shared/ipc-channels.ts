export const IPC_CHANNELS = {
  restore: "session:restore",
  login: "session:login",
  sendMfa: "session:send-mfa",
  verifyMfa: "session:verify-mfa",
  logout: "session:logout",
  listClassifications: "library:list-classifications",
  playerChooseLocalFile: "player:choose-local-file",
  playerCommand: "player:command",
  playerEvent: "player:event",
} as const;
