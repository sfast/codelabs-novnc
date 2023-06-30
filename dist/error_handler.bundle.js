(window["webpackJsonp"] = window["webpackJsonp"] || []).push([[1],{

/***/ 528:
/***/ (function(module, exports) {

/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC Authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

// NB: this should *not* be included as a module until we have
// native support in the browsers, so that our error handler
// can catch script-loading errors.

// No ES6 can be used in this file since it's used for the translation
/* eslint-disable prefer-arrow-callback */

(function _scope() {
  "use strict";

  // Fallback for all uncaught errors
  function handleError(event, err) {
    try {
      var msg = document.getElementById('noVNC_fallback_errormsg');

      // Only show the initial error
      if (msg.hasChildNodes()) {
        return false;
      }

      // Skip allowed errors
      var allowedErrors = ["The user has exited the lock before this request was completed."];
      if (event.message && allowedErrors.includes(event.message)) {
        return false;
      }
      return location.reload();
      var div = document.createElement("div");
      div.classList.add('noVNC_message');
      div.appendChild(document.createTextNode(event.message));
      msg.appendChild(div);
      if (event.filename) {
        div = document.createElement("div");
        div.className = 'noVNC_location';
        var text = event.filename;
        if (event.lineno !== undefined) {
          text += ":" + event.lineno;
          if (event.colno !== undefined) {
            text += ":" + event.colno;
          }
        }
        div.appendChild(document.createTextNode(text));
        msg.appendChild(div);
      }
      if (err && err.stack) {
        div = document.createElement("div");
        div.className = 'noVNC_stack';
        div.appendChild(document.createTextNode(err.stack));
        msg.appendChild(div);
      }
      document.getElementById('noVNC_fallback_error').classList.add("noVNC_open");
    } catch (exc) {
      document.write("Kasm encountered an error.");
    }
    // Don't return true since this would prevent the error
    // from being printed to the browser console.
    return false;
  }
  window.addEventListener('error', function onerror(evt) {
    handleError(evt, evt.error);
  });
  window.addEventListener('unhandledrejection', function onreject(evt) {
    handleError(evt.reason, evt.reason);
  });
})();

/***/ })

},[[528,0]]]);