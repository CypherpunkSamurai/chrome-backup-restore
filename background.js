"use strict";
// Service worker for Chrome Data Manager
// All data logic runs in popup.js.
//
// The toolbar icon is a filled banana tile, so it reads on a light and a dark
// toolbar alike and there is no second icon set to swap. This file exists
// because manifest_version: 3 requires a service worker.

chrome.runtime.onInstalled.addListener(() => {
  console.log("Chrome Data Manager installed.");
});
