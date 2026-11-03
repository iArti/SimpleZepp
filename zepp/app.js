import { BaseApp } from "@zeppos/zml/base-app";
import { localStorage } from "@zos/storage";
import { saveAppIcon } from "./shared/players";

App(
  BaseApp({
    globalData: {
      // Media page hook: called with the file path of each received cover
      onCover: null,
      // Player page hook: called with (package, file path) of each received app icon
      onAppIcon: null,
      // Receives image files from the phone; see shared/files.js
      handleFile: null,
      // The media page attached SimpleWear to a player; the dashboard detaches it
      mediaActive: false,
    },

    onCreate() {
      this.globalData.handleFile = (file) => this.handleFile(file);
    },

    // zml owns the TransferFile inbox and hands us each incoming file
    onReceivedFile(file) {
      this.handleFile(file);
    },

    handleFile(file) {
      if (!file) return;
      if (file.readyState === "transferred") {
        this.saveFile(file);
        return;
      }
      file.on("change", (event) => {
        if (event.data.readyState === "transferred") this.saveFile(file);
      });
    },

    // Covers { kind: "cover", coverId } and player app icons { kind: "appicon", pkg }
    saveFile(file) {
      let params = file.params || {};
      if (typeof params === "string") {
        try {
          params = JSON.parse(params);
        } catch (e) {
          params = {};
        }
      }
      if (params.kind === "appicon") {
        saveAppIcon(params.pkg, file.filePath);
        if (this.globalData.onAppIcon) this.globalData.onAppIcon(params.pkg, file.filePath);
        return;
      }
      localStorage.setItem("coverPath", file.filePath);
      localStorage.setItem("coverId", params.coverId || "");
      if (this.globalData.onCover) this.globalData.onCover(file.filePath, params.coverId);
    },

    onDestroy() {},
  })
);
