// zml quirk: destroying any BasePage calls fileTransferLib.offFile(), which drops
// the inbox listener and every callback, including the app's. Re-arm it.
export function ensureFileReceiver() {
  const app = getApp();
  const globalData = app.globalData || (app._options && app._options.globalData);
  const lib = globalData && globalData.fileTransferLib;
  if (!lib || !lib.canUseFileTransfer() || !globalData.handleFile) return;

  lib.offFile();
  lib.init();
  lib.onFile(globalData.handleFile);
}
