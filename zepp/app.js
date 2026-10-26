import { BaseApp } from "@zeppos/zml/base-app";
import { localStorage } from "@zos/storage";

App(
  BaseApp({
    globalData: {
      // Media page hook: called with the file path of each received cover
      onCover: null,
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

    // Only covers are sent: { kind: "cover", coverId }
    saveFile(file) {
      let params = file.params || {};
      if (typeof params === "string") {
        try {
          params = JSON.parse(params);
        } catch (e) {
          params = {};
        }
      }
      localStorage.setItem("coverPath", file.filePath);
      localStorage.setItem("coverId", params.coverId || "");
      if (this.globalData.onCover) this.globalData.onCover(file.filePath, params.coverId);
    },

    onDestroy() {},
  })
);
